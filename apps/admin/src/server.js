import http from "node:http";
import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  randomToken,
  requireEnv,
  requireStrongSecret,
  timingSafeEqualText
} from "../../../packages/core/src/config.js";
import { readAuditEvents, verifyAuditLog, writeAuditEvent } from "../../../packages/core/src/audit.js";
import { listBookings } from "../../../packages/core/src/booking-store.js";
import { loadPublicConfig, updatePublicConfig } from "../../../packages/core/src/public-config-store.js";
import { securityHeaders, assertSafeOrigin } from "./security.js";
import { listScreenSessions, submitAnswer, closeScreenSession } from "../../../packages/core/src/screen-session-store.js";

const port = Number(process.env.ADMIN_PORT || 3000);
const adminUser = requireEnv("ADMIN_USERNAME");
const adminPassword = requireStrongSecret("ADMIN_PASSWORD", 16);
const sessionSecret = requireStrongSecret("ADMIN_SESSION_SECRET");
const allowedOrigin = process.env.ADMIN_ALLOWED_ORIGIN || "";
const sessionStorePath = resolve(process.env.SESSION_STORE_FILE || "./.data/sessions.json");
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 10_000);
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000) throw new Error("REQUEST_TIMEOUT_MS must be an integer of at least 1000");

const sessions = new Map();
const attempts = new Map();
let sessionWriteQueue = Promise.resolve();

function sessionKey(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
async function loadSessionStore() {
  try {
    const parsed = JSON.parse(await readFile(sessionStorePath, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error("invalid session store");
    for (const entry of parsed.sessions) {
      if (!Array.isArray(entry) || entry.length !== 2 || !/^[a-f0-9]{64}$/.test(entry[0]) ||
          typeof entry[1]?.username !== "string" || typeof entry[1]?.csrf !== "string" ||
          !Number.isFinite(entry[1]?.expiresAt) || entry[1]?.role !== "founder") throw new Error("invalid session entry");
      sessions.set(entry[0], entry[1]);
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function persistSessions() {
  const task = sessionWriteQueue.then(async () => {
    await mkdir(dirname(sessionStorePath), { recursive: true });
    const tmp = sessionStorePath + "." + crypto.randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify({ version: 1, sessions: [...sessions.entries()] }, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tmp, sessionStorePath);
  });
  sessionWriteQueue = task.catch(() => {});
  return task;
}
await loadSessionStore();

function json(res,status,body,headers={}) {
  securityHeaders(res);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers});
  res.end(JSON.stringify(body));
}
function signSession(token) { return crypto.createHmac("sha256",sessionSecret).update(token).digest("base64url"); }
function cookie(name,value,maxAge) {
  const secure=process.env.NODE_ENV==="production" ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}
function parseCookies(header="") {
  return Object.fromEntries(header.split(";").map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf("=");return i===-1?[v,""]:[v.slice(0,i),v.slice(i+1)];}));
}
async function readBody(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>16_384){const e=new Error("request body too large");e.statusCode=413;throw e;}
    chunks.push(chunk);
  }
  try{return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};}catch{const e=new Error("invalid JSON body");e.statusCode=400;throw e;}
}
function rateLimited(req) {
  const key=req.socket.remoteAddress||"unknown", now=Date.now();
  const list=(attempts.get(key)||[]).filter(t=>now-t<60_000);
  if(list.length>=10){attempts.set(key,list);return true;}
  list.push(now);attempts.set(key,list);return false;
}
async function sessionFrom(req) {
  const raw=parseCookies(req.headers.cookie).soularab_admin;
  if(!raw)return null;
  const [token,signature]=raw.split(".");
  if(!token||!signature||!timingSafeEqualText(signature,signSession(token)))return null;
  const session=sessions.get(sessionKey(token));
  if(!session)return null;
  if(session.expiresAt<Date.now()){sessions.delete(sessionKey(token));await persistSessions();return null;}
  return {token,...session};
}
async function requireFounder(req,res) {
  const session=await sessionFrom(req);
  if(!session||session.role!=="founder"){json(res,401,{error:"authentication_required"});return null;}
  return session;
}
async function audit(req,action,result,metadata={},actorOverride=null) {
  const session=actorOverride?null:await sessionFrom(req);
  return writeAuditEvent({actor:actorOverride||session?.username||"anonymous",action,target:"founder-console",result,correlationId:req.headers["x-correlation-id"]||randomToken(12),metadata});
}

const server=http.createServer(async(req,res)=>{
  try {
    if(!assertSafeOrigin(req,allowedOrigin)){await audit(req,"request.origin","denied");return json(res,403,{error:"origin_denied"});}
    if(req.method==="GET" && ["/","/styles.css","/app.js"].includes(req.url)){
      const asset=req.url==="/"?"index.html":req.url.slice(1);
      const types={"index.html":"text/html; charset=utf-8","styles.css":"text/css; charset=utf-8","app.js":"text/javascript; charset=utf-8"};
      const content=await readFile(new URL("../web/"+asset,import.meta.url));
      securityHeaders(res);res.writeHead(200,{"content-type":types[asset],"cache-control":"no-cache"});return res.end(content);
    }
    if(req.method==="GET"&&req.url==="/health")return json(res,200,{ok:true,service:"admin"});
    if(req.method==="GET"&&req.url==="/ready"){
      const integrity=await verifyAuditLog();
      return json(res,integrity.ok?200:503,{ok:integrity.ok,service:"admin",ready:integrity.ok});
    }
    if(req.method==="POST"&&req.url==="/api/auth/login"){
      if(rateLimited(req)){await audit(req,"auth.login","rate_limited");return json(res,429,{error:"too_many_attempts"});}
      const body=await readBody(req);
      const valid=body.username===adminUser&&timingSafeEqualText(String(body.password||""),adminPassword);
      if(!valid){await audit(req,"auth.login","denied");return json(res,401,{error:"invalid_credentials"});}
      const token=randomToken(48),csrf=randomToken(32);
      sessions.set(sessionKey(token),{username:adminUser,role:"founder",csrf,expiresAt:Date.now()+8*60*60*1000});
      try{await persistSessions();await audit(req,"auth.login","success");}catch(error){sessions.delete(sessionKey(token));await persistSessions();throw error;}
      return json(res,200,{ok:true,user:{username:adminUser,role:"founder"},csrfToken:csrf},{"set-cookie":cookie("soularab_admin",`${token}.${signSession(token)}`,8*60*60)});
    }
    if(req.method==="POST"&&req.url==="/api/auth/logout"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      sessions.delete(sessionKey(session.token));await persistSessions();await audit(req,"auth.logout","success",{},session.username);
      return json(res,200,{ok:true},{"set-cookie":cookie("soularab_admin","",0)});
    }
    if(req.method==="GET"&&req.url==="/api/auth/me"){
      const session=await requireFounder(req,res);if(!session)return;
      return json(res,200,{ok:true,user:{username:session.username,role:session.role},csrfToken:session.csrf});
    }
    if(req.method==="GET"&&req.url==="/api/control/bookings"){
      const session=await requireFounder(req,res);if(!session)return;
      const bookings=await listBookings();
      return json(res,200,{ok:true,bookings});
    }
    if(req.method==="GET"&&req.url==="/api/control/screen-sessions"){
      const session=await requireFounder(req,res);if(!session)return;
      return json(res,200,{ok:true,sessions:await listScreenSessions()});
    }
    if(req.method==="POST"&&req.url==="/api/control/screen-sessions/answer"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);const result=await submitAnswer(body.sessionId,body.answer);
      if(!result.error)await audit(req,"screen-session.answer","success",{sessionId:body.sessionId});
      return json(res,result.error?404:200,result);
    }
    if(req.method==="POST"&&req.url==="/api/control/screen-sessions/close"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);const result=await closeScreenSession(body.sessionId);
      return json(res,result.error?404:200,result);
    }
    if(req.method==="GET"&&req.url==="/api/control/public-status"){
      const session=await requireFounder(req,res);if(!session)return;
      return json(res,200,{ok:true,config:await loadPublicConfig()});
    }
    if(req.method==="POST"&&req.url==="/api/control/public-config"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);
      if(typeof body.message!=="string"||body.message.length>500)return json(res,400,{error:"invalid_input"});
      const saved=await updatePublicConfig(body.message); if(saved.error)return json(res,400,{error:saved.error});
      await audit(req,"public-config.update","success",{length:body.message.length});
      return json(res,200,{ok:true});
    }
    if(req.method==="GET"&&req.url==="/api/control/audit-integrity"){
      const session=await requireFounder(req,res);if(!session)return;
      const integrity=await verifyAuditLog();return json(res,integrity.ok?200:503,{ok:integrity.ok,integrity});
    }
    if(req.method==="GET"&&req.url.startsWith("/api/control/audit-events")){
      const session=await requireFounder(req,res);if(!session)return;
      const url=new URL(req.url,"http://localhost"),limit=Number(url.searchParams.get("limit")||50);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)return json(res,400,{error:"invalid_limit"});
      const integrity=await verifyAuditLog();if(!integrity.ok)return json(res,503,{error:"audit_integrity_failed"});
      return json(res,200,{ok:true,events:await readAuditEvents(limit),integrity});
    }
    return json(res,404,{error:"not_found"});
  } catch(error) {
    try{await audit(req,"request","error",{message:error.message});}catch{}
    return json(res,error.statusCode||500,{error:error.statusCode===413?"payload_too_large":error.statusCode===400?"invalid_request":"internal_error"});
  }
});
server.requestTimeout=requestTimeoutMs;server.headersTimeout=Math.min(requestTimeoutMs,10_000);server.keepAliveTimeout=Math.min(requestTimeoutMs,5_000);
server.listen(port,()=>console.log(`admin service listening on ${port}`));