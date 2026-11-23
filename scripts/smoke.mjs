import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const root=tmpdir();
const bookingStore=join(root,"soularab-bookings-"+randomUUID()+".json");
const screenStore=join(root,"soularab-screens-"+randomUUID()+".json");
const sessionStore=join(root,"soularab-sessions-"+randomUUID()+".json");
const credentialStore=join(root,"soularab-credentials-"+randomUUID()+".json");
const configStore=join(root,"soularab-config-"+randomUUID()+".json");
const auditStore=join(root,"soularab-audit-"+randomUUID()+".jsonl");
const env={...process.env,NODE_ENV:"production",PUBLIC_PORT:"4100",ADMIN_PORT:"3100",ADMIN_USERNAME:"founder",ADMIN_PASSWORD:"phase2-test-password",ADMIN_SESSION_SECRET:"phase2-session-secret-01234567890123456789",BOOKING_STORE_FILE:bookingStore,SCREEN_SESSION_STORE_FILE:screenStore,SESSION_STORE_FILE:sessionStore,ADMIN_CREDENTIALS_FILE:credentialStore,PUBLIC_CONFIG_FILE:configStore,AUDIT_LOG_FILE:auditStore};

const processes=[spawn(process.execPath,["apps/public/src/server.js"],{env,stdio:"ignore"}),spawn(process.execPath,["apps/admin/src/server.js"],{env,stdio:"ignore"})];
async function request(url,options={}){for(let i=0;i<40;i++){try{return await fetch(url,options)}catch{await sleep(100)}}throw new Error("service unavailable: "+url)}
try{
  const publicPage=await request("http://127.0.0.1:4100/");if(!publicPage.ok||!(await publicPage.text()).includes("SOULARAB"))throw new Error("public interface failed");
  const adminPage=await request("http://127.0.0.1:3100/");if(!adminPage.ok||!(await adminPage.text()).includes("مركز المؤسس"))throw new Error("founder interface failed");
  for(const url of ["http://127.0.0.1:4100/health","http://127.0.0.1:3100/health","http://127.0.0.1:3100/ready"]){const r=await request(url);if(!r.ok)throw new Error("health failed: "+url)}
  const consentDenied=await request("http://127.0.0.1:4100/api/bookings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"test@example.com",screenConsent:false,locationConsent:false,screenPermission:"denied",locationPermission:"denied"})});
  if(consentDenied.status!==403)throw new Error("booking accepted without explicit permissions");
  const booking=await request("http://127.0.0.1:4100/api/bookings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"test@example.com",screenConsent:true,locationConsent:true,screenPermission:"granted",locationPermission:"granted",screenSessionRequested:true,location:{latitude:41.0,longitude:29.0,accuracy:10}})});
  const bookingData=await booking.json();if(booking.status!==202||!bookingData.bookingId)throw new Error("booking creation failed");
  const screen=await request("http://127.0.0.1:4100/api/screen-sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bookingId:bookingData.bookingId})});
  const screenData=await screen.json();if(screen.status!==201||!screenData.sessionId)throw new Error("screen session creation failed");

  const login=await request("http://127.0.0.1:3100/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"founder",password:"phase2-test-password"})});
  if(!login.ok)throw new Error("admin login failed");
  const loginData=await login.json();const cookie=login.headers.get("set-cookie")?.split(";")[0];if(!cookie||!loginData.csrfToken)throw new Error("session material missing");

  const bookings=await request("http://127.0.0.1:3100/api/control/bookings",{headers:{cookie}});
  const bookingsData=await bookings.json();if(!bookings.ok||!bookingsData.bookings.some(x=>x.bookingId===bookingData.bookingId))throw new Error("founder booking list failed");
  const sessions=await request("http://127.0.0.1:3100/api/control/screen-sessions",{headers:{cookie}});
  const sessionsData=await sessions.json();if(!sessions.ok||!sessionsData.sessions.some(x=>x.sessionId===screenData.sessionId))throw new Error("founder screen session list failed");

  const note=await request("http://127.0.0.1:3100/api/control/bookings/notes",{method:"POST",headers:{"content-type":"application/json",cookie,"x-csrf-token":loginData.csrfToken},body:JSON.stringify({bookingId:bookingData.bookingId,notes:"اختبار مؤسس"})});
  if(!note.ok)throw new Error("founder notes update failed");

  const config={status:"online",message:"controlled by founder",showAds:true,showWithdrawals:true,showBooking:true,offers:[["A","B"],["C","D"],["E","F"],["G","H"],["I","J"]],withdrawals:["X"]};
  const configUpdate=await request("http://127.0.0.1:3100/api/control/public-config",{method:"POST",headers:{"content-type":"application/json",cookie,"x-csrf-token":loginData.csrfToken},body:JSON.stringify(config)});
  if(!configUpdate.ok)throw new Error("public configuration update failed");
  const publicStatus=await request("http://127.0.0.1:4100/api/public/status");const publicData=await publicStatus.json();if(!publicStatus.ok||publicData.config.message!=="controlled by founder"||publicData.config.offers.length!==5)throw new Error("public configuration readback failed");

  const audit=await request("http://127.0.0.1:3100/api/control/audit-integrity",{headers:{cookie}});const auditData=await audit.json();if(!audit.ok||!auditData.integrity.ok)throw new Error("audit integrity failed");

  const admin=processes[1];const stopped=new Promise(resolve=>admin.once("exit",resolve));admin.kill("SIGTERM");await stopped;processes[1]=spawn(process.execPath,["apps/admin/src/server.js"],{env,stdio:"ignore"});
  const restored=await request("http://127.0.0.1:3100/api/auth/me",{headers:{cookie}});if(!restored.ok)throw new Error("founder session did not persist");

  const logout=await request("http://127.0.0.1:3100/api/auth/logout",{method:"POST",headers:{cookie,"x-csrf-token":(await restored.json()).csrfToken}});if(!logout.ok)throw new Error("logout failed");
  console.log("SOULARAB_SMOKE_OK");
}finally{for(const p of processes)p.kill("SIGTERM");for(const file of [bookingStore,screenStore,sessionStore,credentialStore,configStore,auditStore])await rm(file,{force:true})}