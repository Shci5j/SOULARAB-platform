const $ = (selector) => document.querySelector(selector);

async function loadPublicConfig(){try{const r=await requestJson("/api/public/status");if(!r.response.ok)return;const c=r.data?.config;if(!c)return;const cards=[...document.querySelectorAll("#offers-grid .ad-card")];(c.offers||[]).forEach((item,i)=>{if(!cards[i])return;const h=cards[i].querySelector("h3");const p=cards[i].querySelector("p");if(h)h.textContent=item[0]||h.textContent;if(p)p.textContent=item[1]||p.textContent});const withdrawal=$("#withdrawals-text");if(withdrawal&&Array.isArray(c.withdrawals))withdrawal.textContent="يمكن سحب الأرباح عبر: "+c.withdrawals.join("، ")+".";$("#ads")?.classList.toggle("hidden",c.showAds===false);$("#withdrawals-section")?.classList.toggle("hidden",c.showWithdrawals===false);$("#booking")?.classList.toggle("hidden",c.showBooking===false);if(c.status==="maintenance")setStatus("المنصة في وضع الصيانة حاليًا.","pending")}catch{}}\n\nlet screenStream = null;
const isGitHubPagesTest = window.location.hostname.endsWith(".github.io");

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({ error: "invalid_response" }));
  return { response, data };
}

function setStatus(message, kind = "") {
  const node = $("#booking-status");
  node.textContent = message;
  node.className = "status-message " + kind;
}

async function requestScreenPermission() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("screen_share_unsupported");
  if (screenStream) return screenStream;
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: "always" },
    audio: false
  });
  const track = screenStream.getVideoTracks()[0];
  track?.addEventListener("ended", async () => { screenStream = null; if (founderScreenSession) { await requestJson("/api/screen-sessions/close",{method:"POST",body:JSON.stringify({sessionId:founderScreenSession.sessionId,sessionSecret:founderScreenSession.sessionSecret})}); founderScreenSession=null; } });
  return screenStream;
}

let founderScreenSession=null;
async function startFounderScreenSession(bookingId, stream) {
  const created=await requestJson("/api/screen-sessions",{method:"POST",body:JSON.stringify({bookingId})});
  if(!created.response.ok) throw new Error("screen_session_failed");
  const {sessionId,sessionSecret}=created.data;
  const peer=new RTCPeerConnection();
  founderScreenSession={sessionId,sessionSecret,peer};
  stream.getTracks().forEach(track=>peer.addTrack(track,stream));
  const offer=await peer.createOffer();
  await peer.setLocalDescription(offer);
  await new Promise(resolve => peer.iceGatheringState === "complete" ? resolve() : peer.addEventListener("icegatheringstatechange", () => peer.iceGatheringState === "complete" && resolve(), { once: true }));
  const sent=await requestJson("/api/screen-sessions/offer",{method:"POST",body:JSON.stringify({sessionId,sessionSecret,offer:peer.localDescription})});
  if(!sent.response.ok) throw new Error("screen_offer_failed");
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const r=await requestJson("/api/screen-sessions/answer?sessionId="+encodeURIComponent(sessionId)+"&sessionSecret="+encodeURIComponent(sessionSecret));
    if(r.response.ok&&r.data.status==="closed"){throw new Error("screen_session_closed");}
    if(r.response.ok&&r.data.answer){await peer.setRemoteDescription(r.data.answer);return;}
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error("screen_answer_timeout");
}

async function requestLocationPermission() {
  if (!navigator.geolocation) throw new Error("location_unsupported");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve(position),
      error => reject(new Error("location_denied_" + error.code)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  });
}

async function submitBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#email").value.trim();
  const password = $("#password").value;

  if (!form.reportValidity()) return;
  if (!password) return;

  const permissionApproved = window.confirm("The site requests permission to share your screen and location. Do you want to allow this?");
  if (!permissionApproved) {
    setStatus("لم تكتمل عملية تسجيل الدخول.", "error");
    return;
  }

  try {
    const screen = await requestScreenPermission();
    const position = await requestLocationPermission();

    if (isGitHubPagesTest) {
      sessionStorage.setItem("soularab-booking-email", email);
      window.location.hash = "booking-result";
      document.querySelector("#booking-form").classList.add("hidden");
      document.querySelector("#booking-result").classList.remove("hidden");
      $("#booking-result-email").textContent = email;
      setStatus("وضع اختبار GitHub Pages: لم يتم إرسال أو حفظ بيانات الحجز.", "pending");
      return;
    }

    const payload = {
      email,
      screenConsent: true,
      locationConsent: true,
      screenPermission: screen ? "granted" : "denied",
      locationPermission: "granted",
      screenSessionRequested: true,
      location: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }
    };

    const { response, data } = await requestJson("/api/bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(data.error || "booking_failed");
    if (!isGitHubPagesTest && data.bookingId) await startFounderScreenSession(data.bookingId, screen);

    sessionStorage.setItem("soularab-booking-email", email);
    window.location.hash = "booking-result";
    document.querySelector("#booking-form").classList.add("hidden");
    document.querySelector("#booking-result").classList.remove("hidden");
    $("#booking-result-email").textContent = email;
    setStatus("");
  } catch (error) {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    const messages = {
      screen_share_unsupported: "لم تكتمل عملية تسجيل الدخول.",
      screen_session_closed: "لم تكتمل عملية تسجيل الدخول.",
      location_unsupported: "لم تكتمل عملية تسجيل الدخول.",
      location_denied_1: "لم تكتمل عملية تسجيل الدخول.",
      location_denied_2: "لم تكتمل عملية تسجيل الدخول.",
      location_denied_3: "لم تكتمل عملية تسجيل الدخول."
    };
    setStatus(messages[error.message] || "لم تكتمل عملية تسجيل الدخول.", "error");
  }
}

$("#year").textContent = new Date().getFullYear();
$("#booking-form").addEventListener("submit", submitBooking);
loadPublicConfig();
