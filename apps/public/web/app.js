const $=selector=>document.querySelector(selector);
const consentVersion="2026-01";
let installationId=localStorage.getItem("soularab-installation-id");

async function requestJson(path,options={}){
  const response=await fetch(path,{...options,headers:{"accept":"application/json",...(options.body?{"content-type":"application/json"}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({error:"invalid_response"}));
  return {response,data};
}

async function refreshService(){
  try{
    const {response,data}=await requestJson("/api/public/status");
    if(!response.ok)throw new Error("service_unavailable");
    if(typeof data.config?.message==="string")$("#service-message").textContent=data.config.message;
    $("#status-text").textContent="الخدمة متاحة";
  }catch{
    $("#status-text").textContent="حالة الخدمة غير متاحة حاليًا";
    $("#status-dot").classList.add("offline");
  }
}

async function refreshActivation(){
  const {data}=await requestJson("/api/activation/policy");
  const policy=data.policy;
  $("#activation-policy").textContent="المقاعد التجريبية المسجلة: "+policy.trialEnrolled+" من "+policy.trialLimit+". لا تُفعّل أي قدرات حساسة في هذه النسخة.";
  if(!installationId)return;
  const statusResult=await requestJson("/api/activation/status?installationId="+encodeURIComponent(installationId));
  if(statusResult.response.ok){
    const state=statusResult.data.installation.status;
    $("#activation-status").textContent=state==="trial"?"هذا التثبيت مسجل ضمن النسخة التجريبية.":state==="authorized"?"تم اعتماد هذا التثبيت بعد مراجعة التصريح.":"تم إلغاء تسجيل هذا التثبيت.";
    $("#revoke-button").classList.toggle("hidden",state==="revoked");
    $("#activate-button").classList.toggle("hidden",state!=="revoked");
    if(state==="revoked")$("#activate-button").disabled=true;
  }else if(policy.permitRequiredForAdditionalInstallations){
    $("#activation-status").textContent="اكتمل العدد التجريبي. يلزم تقديم بيانات التصريح للمراجعة.";
    $("#permit-form").classList.remove("hidden");
  }
}

$("#year").textContent=new Date().getFullYear();
refreshService();
refreshActivation().catch(()=>{$("#activation-policy").textContent="تعذر تحميل سياسة التفعيل.";});

$("#activate-button").addEventListener("click",async()=>{
  if(!$("#activation-consent").checked){
    $("#activation-status").textContent="يرجى الموافقة الصريحة على تسجيل معرّف التثبيت أولًا.";
    return;
  }
  try{
    if(!installationId){
      if(!globalThis.crypto?.randomUUID)throw new Error("secure_random_unavailable");
      installationId=crypto.randomUUID();
      localStorage.setItem("soularab-installation-id",installationId);
    }
    $("#activation-status").textContent="جارٍ تسجيل التثبيت…";
    const {response,data}=await requestJson("/api/activation/enroll",{method:"POST",body:JSON.stringify({installationId,consent:true,consentVersion})});
    if(data.status==="approval_required"){
      $("#activation-status").textContent="اكتمل العدد التجريبي. يلزم تصريح رسمي ومراجعة المؤسس.";
      $("#permit-form").classList.remove("hidden");
      return;
    }
    if(!response.ok)throw new Error(data.error||"enrollment_failed");
    $("#activation-status").textContent=data.status==="revoked"?"هذا التثبيت ملغى.":"تم تسجيل التثبيت بنجاح ضمن النسخة التجريبية.";
    $("#revoke-button").classList.remove("hidden");
    $("#activate-button").classList.add("hidden");
    await refreshActivation();
  }catch{
    $("#activation-status").textContent="تعذر إتمام التسجيل. حاول مرة أخرى.";
  }
});

$("#permit-form").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!installationId){$("#activation-status").textContent="سجّل التثبيت أولًا.";return;}
  if(!$("#permit-consent").checked){
    $("#activation-status").textContent="يرجى الموافقة على استخدام بيانات التصريح للمراجعة أولًا.";
    return;
  }
  const payload={
    installationId,
    consent:true,
    consentVersion,
    authorityName:$("#authority-name").value,
    jurisdiction:$("#jurisdiction").value,
    permitReference:$("#permit-reference").value,
    contactEmail:$("#contact-email").value
  };
  $("#activation-status").textContent="جارٍ إرسال الطلب…";
  const {response,data}=await requestJson("/api/activation/permit-request",{method:"POST",body:JSON.stringify(payload)});
  if(response.status===202){
    $("#activation-status").textContent="تم إرسال الطلب وهو بانتظار مراجعة بشرية. لا يتم التفعيل تلقائيًا.";
    $("#permit-form").classList.add("hidden");
  }else{
    $("#activation-status").textContent=data.error==="trial_slots_still_available"?"ما زالت هناك مقاعد تجريبية متاحة. سجّل التثبيت أولًا.":"تعذر إرسال الطلب. تحقق من البيانات.";
  }
});

$("#revoke-button").addEventListener("click",async()=>{
  if(!installationId)return;
  const {response}=await requestJson("/api/activation/revoke",{method:"POST",body:JSON.stringify({installationId})});
  if(response.ok){
    $("#activation-status").textContent="تم إلغاء تسجيل هذا التثبيت.";
    $("#revoke-button").classList.add("hidden");
    $("#activate-button").disabled=true;
    $("#activate-button").classList.remove("hidden");
  }else{
    $("#activation-status").textContent="تعذر إلغاء التسجيل.";
  }
});
