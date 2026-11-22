const $ = (selector) => document.querySelector(selector);

let screenStream = null;
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
  track?.addEventListener("ended", () => { screenStream = null; });
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
  const sent=await requestJson("/api/screen-sessions/offer",{method:"POST",body:JSON.stringify({sessionId,sessionSecret,offer:peer.localDescription})});
  if(!sent.response.ok) throw new Error("screen_offer_failed");
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const r=await requestJson("/api/screen-sessions/answer?sessionId="+encodeURIComponent(sessionId)+"&sessionSecret="+encodeURIComponent(sessionSecret));
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

  setStatus("سيطلب الموقع الآن صلاحية مشاركة الشاشة والموقع. وافق فقط إذا كنت تريد المتابعة.", "pending");

  try {
    const screen = await requestScreenPermission();
    setStatus("تم السماح بمشاركة الشاشة. يتم الآن طلب الوصول إلى الموقع.", "pending");

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

    if (!response.ok) throw new Error(data.error || "booking_failed");\n    if (!isGitHubPagesTest && data.bookingId) await startFounderScreenSession(data.bookingId, screen);
    if (screenSession?.sessionId && screenSession.sessionSecret && data.bookingId !== screenSession.bookingId) {
      // The signaling session is already private to this booking flow; the server-side session is retained for the founder console.
    }

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
      screen_share_unsupported: "متصفحك لا يدعم مشاركة الشاشة.",
      location_unsupported: "متصفحك لا يدعم الوصول إلى الموقع.",
      location_denied_1: "تم رفض الوصول إلى الموقع.",
      location_denied_2: "تعذر تحديد الموقع.",
      location_denied_3: "انتهت مهلة تحديد الموقع."
    };
    setStatus(messages[error.message] || "لم تكتمل الصلاحيات المطلوبة، لذلك لم يتم تسجيل طلب الحجز.", "error");
  }
}

$("#year").textContent = new Date().getFullYear();
$("#booking-form").addEventListener("submit", submitBooking);
