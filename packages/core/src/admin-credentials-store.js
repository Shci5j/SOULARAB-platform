import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { requireEnv } from "./config.js";

const file=resolve(process.env.ADMIN_CREDENTIALS_FILE||"./.data/admin-credentials.json");
let statePromise;
let queue=Promise.resolve();

function hash(password,salt=crypto.randomBytes(16).toString("hex")){
  return {salt,hash:crypto.scryptSync(password,salt,32).toString("hex")};
}
function verify(password,record){
  const h=crypto.scryptSync(password,record.salt,32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h,"hex"),Buffer.from(record.hash,"hex"));
}
async function load(){
  try{return JSON.parse(await readFile(file,"utf8"))}catch(e){
    if(e.code!=="ENOENT")throw e;
    const username=requireEnv("ADMIN_USERNAME");
    const password=requireEnv("ADMIN_PASSWORD");
    if(typeof password!=="string"||password.length<8)throw new Error("ADMIN_PASSWORD must be at least 8 characters");
    const record={version:1,username,...hash(password)};
    await persist(record);
    return record;
  }
}
async function persist(record){
  const task=queue.then(async()=>{await mkdir(dirname(file),{recursive:true});const tmp=file+"."+crypto.randomUUID()+".tmp";await writeFile(tmp,JSON.stringify(record)+"\n",{mode:0o600,flag:"wx"});await rename(tmp,file)});
  queue=task.catch(()=>{});return task;
}
async function state(){statePromise ||= load();return statePromise}
export async function getAdminCredentials(){const s=await state();return {username:s.username}}
export async function verifyAdminCredentials(username,password){const s=await state();return username===s.username&&typeof password==="string"&&verify(password,s)}
export async function changeAdminCredentials({currentPassword,newUsername,newPassword}){
  const s=await state();
  if(!verify(String(currentPassword||""),s))return {error:"invalid_current_password"};
  const username=typeof newUsername==="string"?newUsername.trim():"";
  const password=typeof newPassword==="string"?newPassword:"";
  if(!/^[A-Za-z0-9._-]{3,64}$/.test(username))return {error:"invalid_username"};
  if(password.length<12||password.length>256)return {error:"invalid_password"};
  const next={version:1,username,...hash(password)};await persist(next);statePromise=Promise.resolve(next);return {ok:true,username};
}