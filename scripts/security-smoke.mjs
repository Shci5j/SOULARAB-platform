import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
const dir=tmpdir(),bookingStore=join(dir,"s-b-"+randomUUID()+".json"),screenStore=join(dir,"s-s-"+randomUUID()+".json"),sessionStore=join(dir,"s-u-"+randomUUID()+".json"),credentialStore=join(dir,"s-c-"+randomUUID()+".json"),configStore=join(dir,"s-g-"+randomUUID()+".json"),auditStore=join(dir,"s-a-"+randomUUID()+".jsonl");
const env={...process.env,NODE_ENV:"production",PUBLIC_PORT:"4200",ADMIN_PORT:"3200",ADMIN_USERNAME:"founder",ADMIN_PASSWORD:"security-test-password",ADMIN_SESSION_SECRET:"security-test-session-secret-01234567890123456789",ADMIN_ALLOWED_ORIGIN:"https://admin.example.test",BOOKING_STORE_FILE:bookingStore,SCREEN_SESSION_STORE_FILE:screenStore,SESSION_STORE_FILE:sessionStore,ADMIN_CREDENTIALS_FILE:credentialStore,PUBLIC_CONFIG_FILE:configStore,AUDIT_LOG_FILE:auditStore};
const children=[spawn(process.execPath,["apps/public/src/server.js"],{env,stdio:"ignore"}),spawn(process.execPath,["apps/admin/src/server.js"],{env,stdio:"ignore"})];
async function request(url,options={}){for(let i=0;i<40;i++){try{return await fetch(url,options)}catch{await sleep(100)}}throw new Error("service unavailable")}
try{
 const admin=await request("http://127.0.0.1:3200/");if(!admin.ok||!admin.headers.get("content-security-policy")?.includes("script-src 'self'"))throw new Error("admin CSP failed");
 const pub=await request("http://127.0.0.1:4200/");if(!pub.ok||!pub.headers.get("content-security-policy")?.includes("default-src 'none'"))throw new Error("public CSP failed");
 for(const url of ["http://127.0.0.1:3200/ready","http://127.0.0.1:4200/ready"]){const r=await request(url);if(!r.ok||r.headers.get("x-content-type-options")!=="nosniff")throw new Error("security headers failed")}
 const originDenied=await request("http://127.0.0.1:3200/api/auth/login",{method:"POST",headers:{"content-type":"application/json",origin:"https://evil.example"},body:JSON.stringify({username:"founder",password:"security-test-password"})});if(originDenied.status!==403)throw new Error("origin protection failed");
 const login=await request("http://127.0.0.1:3200/api/auth/login",{method:"POST",headers:{"content-type":"application/json",origin:"https://admin.example.test"},body:JSON.stringify({username:"founder",password:"security-test-password"})});if(!login.ok)throw new Error("secure login failed");
 const data=await login.json(),cookie=login.headers.get("set-cookie")?.split(";")[0],setCookie=login.headers.get("set-cookie")||"";if(!cookie||!data.csrfToken||!setCookie.includes("Secure")||!setCookie.includes("HttpOnly")||!setCookie.includes("SameSite=Strict"))throw new Error("secure cookie policy failed");
 const csrf=await request("http://127.0.0.1:3200/api/control/public-config",{method:"POST",headers:{"content-type":"application/json",cookie,origin:"https://admin.example.test"},body:JSON.stringify({message:"blocked"})});if(csrf.status!==403)throw new Error("CSRF protection failed");
 const unauth=await request("http://127.0.0.1:3200/api/control/bookings");if(unauth.status!==401)throw new Error("protected monitoring endpoint exposed");
 const badBooking=await request("http://127.0.0.1:4200/api/bookings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"x@example.com",screenConsent:false,locationConsent:false,screenPermission:"denied",locationPermission:"denied"})});if(badBooking.status!==403)throw new Error("permission gate failed");
 const logout=await request("http://127.0.0.1:3200/api/auth/logout",{method:"POST",headers:{cookie,origin:"https://admin.example.test","x-csrf-token":data.csrfToken}});if(!logout.ok)throw new Error("secure logout failed");
 console.log("SOULARAB_SECURITY_SMOKE_OK");
}finally{for(const p of children)p.kill("SIGTERM");for(const file of [bookingStore,screenStore,sessionStore,credentialStore,configStore,auditStore])await rm(file,{force:true})}