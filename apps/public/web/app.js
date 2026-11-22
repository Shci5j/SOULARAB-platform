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

    if (!response.ok) throw new Error(data.error || "booking_failed");

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
