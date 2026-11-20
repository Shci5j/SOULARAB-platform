let csrfToken="";
const $=selector=>document.querySelector(selector);

async function api(path,options={}){
  const headers={accept:"application/json",...(options.headers||{})};
  if(options.body)headers["content-type"]="application/json";
  const response=await fetch(path,{...options,headers,credentials:"same-origin"});
  const data=await response.json().catch(()=>({error:"invalid_response"}));
  if(!response.ok)throw new Error(data.error||"request_failed");
  return data;
}

function showDashboard(user){
  $("#login-panel").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#welcome").textContent="مرحبًا، "+user.username;
}
function showLogin(){
  $("#dashboard").classList.add("hidden");
  $("#login-panel").classList.remove("hidden");
}
async function loadConfig(){
  const data=await api("/api/control/public-status");
  $("#service-state").textContent=data.config?.status==="online"?"متاحة":"غير متاحة";
  $("#service-detail").textContent="آخر استجابة من الخدمة العامة";
  $("#message").value=data.config?.message||"";
}
function makeChip(label,value){
  const chip=document.createElement("span");
  chip.className="stat-chip";
  const strong=document.createElement("strong");
  strong.textContent=String(value);
  chip.append(document.createTextNode(label+" "),strong);
  return chip;
}
function addMeta(parent,label,value){
  const line=document.createElement("p");
  line.textContent=label+": "+value;
  parent.append(line);
}
async function loadActivation(){
  const [overviewData,requestData]=await Promise.all([
    api("/api/control/activation-overview"),
    api("/api/control/permit-requests")
  ]);
  const overview=overviewData.overview;
  const stats=$("#activation-stats");
  stats.replaceChildren(
    makeChip("التجريبي",overview.trialEnrolled+"/"+overview.trialLimit),
    makeChip("المعتمد",overview.authorized),
    makeChip("الملغى",overview.revoked),
    makeChip("بانتظار المراجعة",overview.pendingRequests)
  );
  const list=$("#permit-requests");
  list.replaceChildren();
  const pending=(requestData.requests||[]).filter(item=>item.status==="pending");
  if(!pending.length){
    const empty=document.createElement("p");
    empty.className="empty-state";
    empty.textContent="لا توجد طلبات معلقة حاليًا.";
    list.append(empty);
    return;
  }
  for(const item of pending){
    const card=document.createElement("article");
    card.className="request-row";
    const title=document.createElement("h4");
    title.textContent="طلب تصريح · "+item.requestId.slice(0,8);
    card.append(title);
    const meta=document.createElement("div");
    meta.className="request-meta";
    addMeta(meta,"الجهة",item.authorityName);
    addMeta(meta,"النطاق",item.jurisdiction);
    addMeta(meta,"مرجع التصريح",item.permitReference);
    addMeta(meta,"التواصل",item.contactEmail);
    addMeta(meta,"معرّف التثبيت",item.installationId);
    addMeta(meta,"تاريخ الطلب",new Date(item.submittedAt).toLocaleString());
    card.append(meta);
    const controls=document.createElement("div");
    controls.className="request-controls";
    const verifyLabel=document.createElement("label");
    verifyLabel.className="verify-check";
    const verify=document.createElement("input");
    verify.type="checkbox";
    const verifyText=document.createElement("span");
    verifyText.textContent="تحققت يدويًا من أصالة التصريح والجهة والنطاق والصلاحية.";
    verifyLabel.append(verify,verifyText);
    const reason=document.createElement("textarea");
    reason.rows=2;
    reason.maxLength=500;
    reason.placeholder="سبب القرار (مطلوب، 5 أحرف على الأقل)";
    const actions=document.createElement("div");
    actions.className="request-actions";
    const approve=document.createElement("button");
    approve.type="button";
    approve.className="primary";
    approve.textContent="اعتماد بعد التحقق";
    const reject=document.createElement("button");
    reject.type="button";
    reject.className="danger";
    reject.textContent="رفض الطلب";
    async function review(decision){
      if(reason.value.trim().length<5){
        $("#review-message").textContent="اكتب سببًا واضحًا للقرار.";
        return;
      }
      if(decision==="approve"&&!verify.checked){
        $("#review-message").textContent="لا يمكن الاعتماد دون تأكيد التحقق اليدوي من التصريح.";
        return;
      }
      approve.disabled=true;
      reject.disabled=true;
      try{
        await api("/api/control/permit-review",{
          method:"POST",
          headers:{"x-csrf-token":csrfToken},
          body:JSON.stringify({requestId:item.requestId,decision,verifiedPermit:decision==="approve"&&verify.checked,reason:reason.value})
        });
        $("#review-message").textContent=decision==="approve"?"تم اعتماد الطلب بعد تسجيل التحقق.":"تم رفض الطلب وتسجيل السبب.";
        await loadActivation();
      }catch(error){
        $("#review-message").textContent="تعذر تسجيل القرار: "+error.message;
        approve.disabled=false;
        reject.disabled=false;
      }
    }
    approve.addEventListener("click",()=>review("approve"));
    reject.addEventListener("click",()=>review("reject"));
    actions.append(approve,reject);
    controls.append(verifyLabel,reason,actions);
    card.append(controls);
    list.append(card);
  }
}
async function loadAudit(){
  $("#audit-integrity").textContent="جارٍ التحقق…";
  try{
    const [integrityData,eventData]=await Promise.all([
      api("/api/control/audit-integrity"),
      api("/api/control/audit-events?limit=30")
    ]);
    const integrity=integrityData.integrity;
    $("#audit-integrity").textContent=integrity.ok
      ?"سليم · "+integrity.signedEventCount+" حدثًا موثقًا"+(integrity.legacyEventCount?" · "+integrity.legacyEventCount+" حدث قديم":"")
      :"فشل التحقق من سلامة السجل.";
    const list=$("#audit-events");
    list.replaceChildren();
    for(const event of eventData.events){
      const row=document.createElement("article");
      row.className="audit-row";
      const title=document.createElement("strong");
      title.textContent=event.action+" · "+event.actor;
      const result=document.createElement("span");
      result.className="audit-result";
      result.textContent=event.result;
      const details=document.createElement("span");
      details.textContent=new Date(event.timestamp).toLocaleString()+" · "+event.target+" · "+event.correlationId;
      row.append(title,result,details);
      list.append(row);
    }
    if(!eventData.events.length){
      const empty=document.createElement("p");
      empty.className="empty-state";
      empty.textContent="لا توجد أحداث مسجلة بعد.";
      list.append(empty);
    }
  }catch{
    $("#audit-integrity").textContent="تعذر التحقق من السجل أو قراءته؛ راجع سلامة ملف التدقيق.";
    $("#audit-events").replaceChildren();
  }
}

async function restore(){
  try{
    const me=await api("/api/auth/me");
    csrfToken=me.csrfToken||"";
    showDashboard(me.user);
    await Promise.all([
      loadConfig().catch(()=>{$("#config-message").textContent="تعذر تحميل إعدادات الموقع.";}),
      loadActivation().catch(()=>{$("#review-message").textContent="تعذر تحميل طلبات التصاريح.";}),
      loadAudit()
    ]);
  }catch{
    showLogin();
  }
}

$("#login-form").addEventListener("submit",async event=>{
  event.preventDefault();
  $("#login-message").textContent="جارٍ التحقق…";
  try{
    const data=await api("/api/auth/login",{method:"POST",body:JSON.stringify({username:$("#username").value,password:$("#password").value})});
    csrfToken=data.csrfToken;
    showDashboard(data.user);
    $("#password").value="";
    $("#login-message").textContent="";
    await Promise.all([loadConfig(),loadActivation(),loadAudit()]);
  }catch(error){
    $("#login-message").textContent=error.message==="invalid_credentials"?"بيانات الدخول غير صحيحة":"تعذر تسجيل الدخول. تحقق من الاتصال والإعدادات.";
  }
});
$("#config-form").addEventListener("submit",async event=>{
  event.preventDefault();
  $("#config-message").textContent="جارٍ الحفظ…";
  try{
    await api("/api/control/public-config",{method:"POST",headers:{"x-csrf-token":csrfToken},body:JSON.stringify({message:$("#message").value})});
    $("#config-message").textContent="تم تحديث الرسالة العامة.";
  }catch{
    $("#config-message").textContent="تعذر حفظ التحديث.";
  }
});
$("#refresh-audit").addEventListener("click",loadAudit);
$("#logout").addEventListener("click",async()=>{
  try{await api("/api/auth/logout",{method:"POST",headers:{"x-csrf-token":csrfToken}});}catch{}
  csrfToken="";
  showLogin();
});
restore();
