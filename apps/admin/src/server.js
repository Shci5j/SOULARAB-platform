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
import { listBookings, updateBookingNotes } from "../../../packages/core/src/booking-store.js";
import { loadPublicConfig, updatePublicConfig } from "../../../packages/core/src/public-config-store.js";
import { securityHeaders, assertSafeOrigin } from "./security.js";
import { listScreenSessions, submitAnswer, closeScreenSession } from "../../../packages/core/src/screen-session-store.js";
import { getAdminCredentials, verifyAdminCredentials, changeAdminCredentials } from "../../../packages/core/src/admin-credentials-store.js";

const port = Number(process.env.ADMIN_PORT || 3000);
const publicInternalApiUrl = (process.env.PUBLIC_INTERNAL_API_URL || "").replace(/\/$/, "");
const internalControlToken = process.env.INTERNAL_CONTROL_TOKEN || "";
async function sharedRequest(path, options = {}) {
  if (!publicInternalApiUrl || !internalControlToken) throw new Error("shared_public_api_not_configured");
  const response = await fetch(publicInternalApiUrl + path, {
    ...options,
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), "x-internal-control-token": internalControlToken, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({ error: "invalid_response" }));
  if (!response.ok) { const error = new Error(data.error || "shared_request_failed"); error.statusCode = response.status; throw error; }
  return data;
}

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
    const requestUrl=new URL(req.url,"http://localhost");
    const pathname=requestUrl.pathname;
    if(!assertSafeOrigin(req,allowedOrigin)){await audit(req,"request.origin","denied");return json(res,403,{error:"origin_denied"});}
    if(req.method==="GET" && ["/","/styles.css","/app.js"].includes(pathname)){
      const asset=pathname==="/"?"index.html":pathname.slice(1);
      const types={"index.html":"text/html; charset=utf-8","styles.css":"text/css; charset=utf-8","app.js":"text/javascript; charset=utf-8"};
      const content=await readFile(new URL("../web/"+asset,import.meta.url));
      securityHeaders(res);res.writeHead(200,{"content-type":types[asset],"cache-control":"no-cache"});return res.end(content);
    }
    if(req.method==="GET"&&pathname==="/health")return json(res,200,{ok:true,service:"admin"});
    if(req.method==="GET"&&pathname==="/ready"){
      const integrity=await verifyAuditLog();
      return json(res,integrity.ok?200:503,{ok:integrity.ok,service:"admin",ready:integrity.ok});
    }
    if(req.method==="POST"&&pathname==="/api/auth/login"){
      if(rateLimited(req)){await audit(req,"auth.login","rate_limited");return json(res,429,{error:"too_many_attempts"});}
      const body=await readBody(req);
      try {
        const valid=await verifyAdminCredentials(String(body.username||""),String(body.password||""));
        if(!valid){await audit(req,"auth.login","denied");return json(res,401,{error:"invalid_credentials"});}
        const token=randomToken(48),csrf=randomToken(32);
        const credentials=await getAdminCredentials(); sessions.set(sessionKey(token),{username:credentials.username,role:"founder",csrf,expiresAt:Date.now()+8*60*60*1000});
        try{await persistSessions();await audit(req,"auth.login","success");}catch(error){sessions.delete(sessionKey(token));try{await persistSessions();}catch{};console.error("founder login post-auth failure:",error.message);throw error;}
        return json(res,200,{ok:true,user:{username:credentials.username,role:"founder"},csrfToken:csrf},{"set-cookie":cookie("soularab_admin",token+"."+signSession(token),8*60*60)});
      } catch(error) {
        if(error.message!=="invalid_credentials") console.error("founder login failure:",error.message);
        throw error;
      }
    }
    if(req.method==="POST"&&pathname==="/api/auth/logout"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      sessions.delete(sessionKey(session.token));await persistSessions();await audit(req,"auth.logout","success",{},session.username);
      return json(res,200,{ok:true},{"set-cookie":cookie("soularab_admin","",0)});
    }
    if(req.method==="GET"&&pathname==="/api/auth/me"){
      const session=await requireFounder(req,res);if(!session)return;
      return json(res,200,{ok:true,user:{username:session.username,role:session.role},csrfToken:session.csrf});
    }
    if(req.method==="GET"&&pathname==="/api/control/bookings"){
      const session=await requireFounder(req,res);if(!session)return;
      const bookings=publicInternalApiUrl ? (await sharedRequest("/api/internal/bookings")).bookings : await listBookings();
      return json(res,200,{ok:true,bookings});
    }
    if(req.method==="POST"&&pathname==="/api/control/bookings/notes"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);const result=publicInternalApiUrl ? await sharedRequest("/api/internal/bookings/notes",{method:"POST",body:JSON.stringify({bookingId:body.bookingId,notes:body.notes})}) : await updateBookingNotes(body.bookingId,body.notes);
      if(!result.error)await audit(req,"booking.notes.update","success",{bookingId:body.bookingId});
      return json(res,result.error?404:200,result);
    }
    if(req.method==="GET"&&pathname==="/api/control/screen-sessions"){
      const session=await requireFounder(req,res);if(!session)return;
      return json(res,200,{ok:true,sessions:publicInternalApiUrl ? (await sharedRequest("/api/internal/screen-sessions")).sessions : await listScreenSessions()});
    }
    if(req.method==="POST"&&pathname==="/api/control/screen-sessions/answer"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);const result=publicInternalApiUrl ? await sharedRequest("/api/internal/screen-sessions/answer",{method:"POST",body:JSON.stringify({sessionId:body.sessionId,answer:body.answer})}) : await submitAnswer(body.sessionId,body.answer);
      if(!result.error)await audit(req,"screen-session.answer","success",{sessionId:body.sessionId});
      return json(res,result.error?404:200,result);
    }
    if(req.method==="POST"&&pathname==="/api/control/screen-sessions/close"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);const result=publicInternalApiUrl ? await sharedRequest("/api/internal/screen-sessions/close",{method:"POST",body:JSON.stringify({sessionId:body.sessionId})}) : await closeScreenSession(body.sessionId);
      return json(res,result.error?404:200,result);
    }
    if(req.method==="POST"&&pathname==="/api/control/credentials"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);
      const result=await changeAdminCredentials(body);
      if(result.error)return json(res,400,{error:result.error});
      await audit(req,"founder.credentials.update","success",{usernameChanged:result.username!==session.username});
      return json(res,200,{ok:true,username:result.username});
    }
    if(req.method==="GET"&&pathname==="/api/control/public-status"){
      const session=await requireFounder(req,res);if(!session)return;
      return json(res,200,{ok:true,config:publicInternalApiUrl ? (await sharedRequest("/api/internal/public-config")).config : await loadPublicConfig()});
    }
    if(req.method==="POST"&&pathname==="/api/control/public-config"){
      const session=await requireFounder(req,res);if(!session)return;
      if(req.headers["x-csrf-token"]!==session.csrf)return json(res,403,{error:"csrf_denied"});
      const body=await readBody(req);
      if(typeof body.message!=="string"||body.message.length>500)return json(res,400,{error:"invalid_input"});
      if(body.status!=="online"&&body.status!=="maintenance")return json(res,400,{error:"invalid_status"});
      if(!Array.isArray(body.offers)||body.offers.length!==5)return json(res,400,{error:"invalid_offers"});
      if(!Array.isArray(body.withdrawals)||body.withdrawals.length<1||body.withdrawals.length>10)return json(res,400,{error:"invalid_withdrawals"});
      const saved=publicInternalApiUrl ? await sharedRequest("/api/internal/public-config",{method:"POST",body:JSON.stringify(body)}) : await updatePublicConfig(body); if(saved.error)return json(res,400,{error:saved.error});
      await audit(req,"public-config.update","success",{length:body.message.length,offers:body.offers.length,withdrawals:body.withdrawals.length});
      return json(res,200,{ok:true,config:saved});
    }
    if(req.method==="GET"&&pathname==="/api/control/audit-integrity"){
      const session=await requireFounder(req,res);if(!session)return;
      const integrity=await verifyAuditLog();return json(res,integrity.ok?200:503,{ok:integrity.ok,integrity});
    }
    if(req.method==="GET"&&pathname==="/api/control/audit-events"){
      const session=await requireFounder(req,res);if(!session)return;
      const limit=Number(requestUrl.searchParams.get("limit")||50);
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