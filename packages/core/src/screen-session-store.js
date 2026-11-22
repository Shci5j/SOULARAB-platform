import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const file=resolve(process.env.SCREEN_SESSION_STORE_FILE||"./.data/screen-sessions.json");
const sessions=new Map();
let loaded=false, queue=Promise.resolve();
async function load(){if(loaded)return;loaded=true;try{const x=JSON.parse(await readFile(file,"utf8"));for(const s of x.sessions||[])sessions.set(s.id,s)}catch(e){if(e.code!=="ENOENT")throw e}}
async function save(){const task=queue.then(async()=>{await mkdir(dirname(file),{recursive:true});const tmp=file+"."+crypto.randomUUID()+".tmp";await writeFile(tmp,JSON.stringify({version:1,sessions:[...sessions.values()]})+"\n",{mode:0o600,flag:"wx"});await rename(tmp,file)});queue=task.catch(()=>{});return task}
function clean(){const cutoff=Date.now()-30*60*1000;for(const [id,s] of sessions)if(s.updatedAt<cutoff)sessions.delete(id)}
export async function createScreenSession(bookingId){await load();clean();const id=crypto.randomBytes(24).toString("base64url"),secret=crypto.randomBytes(32).toString("base64url");const s={id,secretHash:crypto.createHash("sha256").update(secret).digest("hex"),bookingId,status:"waiting",offer:null,answer:null,createdAt:Date.now(),updatedAt:Date.now()};sessions.set(id,s);await save();return {sessionId:id,sessionSecret:secret}}
async function get(id,secret){await load();const s=sessions.get(id);if(!s)return null;const h=crypto.createHash("sha256").update(secret).digest("hex");return crypto.timingSafeEqual(Buffer.from(h),Buffer.from(s.secretHash))?s:null}
export async function submitOffer(id,secret,offer){const s=await get(id,secret);if(!s)return {error:"session_not_found"};if(!offer||typeof offer.sdp!=="string"||offer.sdp.length>200000)return {error:"invalid_offer"};s.offer=offer;s.status="offer_ready";s.updatedAt=Date.now();await save();return {ok:true}}
export async function waitForAnswer(id,secret){const s=await get(id,secret);if(!s)return {error:"session_not_found"};return {ok:true,status:s.status,answer:s.answer}}
export async function listScreenSessions(){await load();clean();return [...sessions.values()].map(s=>({sessionId:s.id,bookingId:s.bookingId,status:s.status,offer:s.offer,createdAt:s.createdAt,updatedAt:s.updatedAt}))}
export async function submitAnswer(id,answer){await load();const s=sessions.get(id);if(!s)return {error:"session_not_found"};if(!answer||typeof answer.sdp!=="string"||answer.sdp.length>200000)return {error:"invalid_answer"};s.answer=answer;s.status="connected";s.updatedAt=Date.now();await save();return {ok:true}}
export async function closeScreenSession(id){await load();const s=sessions.get(id);if(!s)return {error:"session_not_found"};s.status="closed";s.updatedAt=Date.now();s.offer=null;s.answer=null;await save();return {ok:true}}