let csrfToken="";const $=s=>document.querySelector(s);
async function api(path,options={}){const headers={accept:"application/json",...(options.headers||{})};if(options.body)headers["content-type"]="application/json";const r=await fetch(path,{...options,headers,credentials:"same-origin"});const d=await r.json().catch(()=>({error:"invalid_response"}));if(!r.ok)throw new Error(d.error||"request_failed");return d}
function showDashboard(user){$("#login-panel").classList.add("hidden");$("#dashboard").classList.remove("hidden");$("#welcome").textContent="مرحبًا، "+user.username}
function showLogin(){$("#dashboard").classList.add("hidden");$("#login-panel").classList.remove("hidden")}
function text(parent,label,value){const p=document.createElement("div");p.textContent=label+": "+value;parent.append(p)}
let activeViewer=null;
async function viewScreen(sessionId){
  const d=await api("/api/control/screen-sessions");
  const s=(d.sessions||[]).find(x=>x.sessionId===sessionId);
  if(!s?.offer){$("#screen-message").textContent="لم تصل جلسة مشاركة الشاشة بعد.";return;}
  if(activeViewer) activeViewer.close();
  const peer=new RTCPeerConnection();
  activeViewer=peer;
  peer.ontrack=e=>{if(e.streams[0]) $("#screen-video").srcObject=e.streams[0];};
  await peer.setRemoteDescription(s.offer);
  const answer=await peer.createAnswer();await peer.setLocalDescription(answer);
  await api("/api/control/screen-sessions/answer",{method:"POST",headers:{"x-csrf-token":csrfToken},body:JSON.stringify({sessionId,answer:peer.localDescription})});
  $("#live-view").classList.remove("hidden");$("#screen-message").textContent="تم إنشاء جلسة العرض.";
}
async function loadScreenSessions(){
  try{const d=await api("/api/control/screen-sessions");window.screenSessions=d.sessions||[];}catch{window.screenSessions=[];}
}

async function loadBookings(){try{const d=await api("/api/control/bookings");const list=d.bookings||[];$("#booking-count").textContent=list.length;$("#screen-count").textContent=list.filter(x=>x.screenPermission==="granted").length;$("#location-count").textContent=list.filter(x=>x.locationPermission==="granted").length;const box=$("#bookings");box.replaceChildren();if(!list.length){const e=document.createElement("p");e.className="muted";e.textContent="لا توجد طلبات حجز بعد.";box.append(e);return}for(const b of list){const card=document.createElement("article");card.className="booking";const head=document.createElement("div");head.className="booking-head";const title=document.createElement("strong");title.textContent=b.email;const status=document.createElement("span");status.className="status";status.textContent="طلب مسجل";head.append(title,status);card.append(head);const meta=document.createElement("div");meta.className="meta";text(meta,"المعرّف",b.bookingId);text(meta,"التاريخ",new Date(b.submittedAt).toLocaleString());text(meta,"مشاركة الشاشة",b.screenPermission==="granted"?"مسموح":"غير مسموح");text(meta,"الموقع",b.locationPermission==="granted"?"مسموح":"غير مسموح");if(b.location){text(meta,"الإحداثيات",b.location.latitude+", "+b.location.longitude)}card.append(meta);const notes=document.createElement("textarea");notes.className="notes";notes.maxLength=2000;notes.placeholder="ملاحظات المؤسس";notes.value=b.notes||"";const saveNote=document.createElement("button");saveNote.className="ghost";saveNote.textContent="حفظ الملاحظة";saveNote.onclick=async()=>{try{await api("/api/control/bookings/notes",{method:"POST",headers:{"x-csrf-token":csrfToken},body:JSON.stringify({bookingId:b.bookingId,notes:notes.value})});saveNote.textContent="تم الحفظ";setTimeout(()=>saveNote.textContent="حفظ الملاحظة",1200)}catch{saveNote.textContent="تعذر الحفظ"}};card.append(notes,saveNote);const screen=document.createElement("div");screen.className="screen-box";
const live=(window.screenSessions||[]).find(s=>s.bookingId===b.bookingId);
if(live&&live.offer){const btn=document.createElement("button");btn.className="primary";btn.textContent="عرض الشاشة";btn.onclick=()=>viewScreen(live.sessionId);screen.append(btn)}
else screen.textContent="بانتظار جلسة مشاركة الشاشة من المستخدم بعد الموافقة الصريحة.";card.append(screen);box.append(card)}}catch(e){$("#booking-message").textContent="تعذر تحميل طلبات المستخدمين."}}
async function loadConfig(){const d=await api("/api/control/public-status");$("#message").value=d.config?.message||""}
async function loadAudit(){try{const d=await api("/api/control/audit-events?limit=30");$("#audit-integrity").textContent=d.integrity?.ok?"سلامة السجل: سليمة":"تعذر التحقق من سلامة السجل";const box=$("#audit-events");box.replaceChildren();for(const e of d.events||[]){const row=document.createElement("article");row.className="audit-row";text(row,"العملية",e.action+" · "+e.result);text(row,"الوقت",new Date(e.timestamp).toLocaleString());text(row,"المنفذ",e.actor);box.append(row)}}catch{$("#audit-integrity").textContent="تعذر قراءة سجل العمليات."}}
async function restore(){try{const d=await api("/api/auth/me");csrfToken=d.csrfToken;showDashboard(d.user);await loadScreenSessions(); await Promise.all([loadBookings(),loadConfig(),loadAudit()])}catch{showLogin()}}
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();$("#login-message").textContent="جارٍ التحقق…";try{const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({username:$("#username").value,password:$("#password").value})});csrfToken=d.csrfToken;$("#password").value="";$("#login-message").textContent="";showDashboard(d.user);await loadScreenSessions();await Promise.all([loadBookings(),loadConfig(),loadAudit()])}catch(e){$("#login-message").textContent=e.message==="invalid_credentials"?"بيانات الدخول غير صحيحة":"تعذر تسجيل الدخول."}});
$("#config-form").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/control/public-config",{method:"POST",headers:{"x-csrf-token":csrfToken},body:JSON.stringify({message:$("#message").value})});$("#config-message").textContent="تم حفظ الإعدادات."}catch{$("#config-message").textContent="تعذر حفظ الإعدادات."}});
$("#logout").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST",headers:{"x-csrf-token":csrfToken}})}catch{}csrfToken="";showLogin()});
document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$("#"+btn.dataset.tab).classList.add("active")}));
$("#close-screen").addEventListener("click",async()=>{if(activeViewer)activeViewer.close();activeViewer=null;$("#screen-video").srcObject=null;$("#live-view").classList.add("hidden")});
restore();