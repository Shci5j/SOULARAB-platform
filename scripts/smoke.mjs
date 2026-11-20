import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const activationStore = join(tmpdir(), "soularab-activation-smoke-" + randomUUID() + ".json");
const sessionStore = join(tmpdir(), "soularab-session-smoke-" + randomUUID() + ".json");
const configStore = join(tmpdir(), "soularab-config-smoke-" + randomUUID() + ".json");
const auditStore = join(tmpdir(), "soularab-audit-smoke-" + randomUUID() + ".jsonl");

const env = {
  ...process.env,
  ADMIN_PORT: "3100",
  PUBLIC_PORT: "4100",
  ADMIN_USERNAME: "founder",
  ADMIN_PASSWORD: "phase2-test-password",
  ADMIN_SESSION_SECRET: "phase2-session-secret-01234567890123456789",
  SERVICE_CONTROL_TOKEN: "phase2-service-token-01234567890123456789",
  PUBLIC_API_URL: "http://127.0.0.1:4100",
  AUDIT_LOG_FILE: auditStore,
  AUDIT_LOG_SECRET: "phase2-audit-integrity-secret-01234567890123456789",
  ACTIVATION_STORE_FILE: activationStore,
  SESSION_STORE_FILE: sessionStore,
  PUBLIC_CONFIG_FILE: configStore
};

const processes = [
  spawn(process.execPath, ["apps/public/src/server.js"], { env, stdio: "ignore" }),
  spawn(process.execPath, ["apps/admin/src/server.js"], { env, stdio: "ignore" })
];

async function request(url, options = {}) {
  for (let i = 0; i < 30; i++) {
    try {
      return await fetch(url, options);
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`service unavailable: ${url}`);
}

try {
  const publicPage = await request("http://127.0.0.1:4100/");
  if (!publicPage.ok || !(await publicPage.text()).includes("SOULARAB")) throw new Error("public interface failed");
  const adminPage = await request("http://127.0.0.1:3100/");
  if (!adminPage.ok || !(await adminPage.text()).includes("مركز التحكم")) throw new Error("founder interface failed");

  const policyResponse = await request("http://127.0.0.1:4100/api/activation/policy");
  const policy = await policyResponse.json();
  if (!policyResponse.ok || policy.policy.trialLimit !== 10) throw new Error("activation policy failed");

  const noConsent = await request("http://127.0.0.1:4100/api/activation/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: randomUUID(), consent: false, consentVersion: "2026-01" })
  });
  if (noConsent.status !== 400) throw new Error("explicit activation consent was not enforced");

  const trialIds = [];
  for (let i = 0; i < 10; i++) {
    const installationId = randomUUID();
    trialIds.push(installationId);
    const enrolled = await request("http://127.0.0.1:4100/api/activation/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId, consent: true, consentVersion: "2026-01" })
    });
    const enrolledData = await enrolled.json();
    if (!enrolled.ok || enrolledData.status !== "trial") throw new Error("trial enrollment failed at slot " + (i + 1));
  }

  const extraInstallationId = randomUUID();
  const capped = await request("http://127.0.0.1:4100/api/activation/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: extraInstallationId, consent: true, consentVersion: "2026-01" })
  });
  if (capped.status !== 409) throw new Error("10-installation trial cap failed");

  const permitConsentDenied = await request("http://127.0.0.1:4100/api/activation/permit-request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId: extraInstallationId,
      authorityName: "Example Competent Authority",
      jurisdiction: "Test jurisdiction",
      permitReference: "TEST-PERMIT-001",
      contactEmail: "review@example.test",
      consent: false,
      consentVersion: "2026-01"
    })
  });
  if (permitConsentDenied.status !== 400) throw new Error("permit data accepted without consent");

  const permitRequest = await request("http://127.0.0.1:4100/api/activation/permit-request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId: extraInstallationId,
      authorityName: "Example Competent Authority",
      jurisdiction: "Test jurisdiction",
      permitReference: "TEST-PERMIT-001",
      contactEmail: "review@example.test",
      consent: true,
      consentVersion: "2026-01"
    })
  });
  const permitData = await permitRequest.json();
  if (permitRequest.status !== 202 || permitData.status !== "pending") throw new Error("permit request submission failed");

  const previousPublic = processes[0];
  const stopped = new Promise(resolve => previousPublic.once("exit", resolve));
  previousPublic.kill("SIGTERM");
  await stopped;
  processes[0] = spawn(process.execPath, ["apps/public/src/server.js"], { env, stdio: "ignore" });
  const persistedPolicyResponse = await request("http://127.0.0.1:4100/api/activation/policy");
  const persistedPolicy = await persistedPolicyResponse.json();
  if (!persistedPolicyResponse.ok || persistedPolicy.policy.trialEnrolled !== 10) {
    throw new Error("activation registry did not persist across restart");
  }

  const publicHealth = await request("http://127.0.0.1:4100/health");
  if (!publicHealth.ok) throw new Error("public health failed");

  const adminHealth = await request("http://127.0.0.1:3100/health");
  if (!adminHealth.ok) throw new Error("admin health failed");

  const denied = await request("http://127.0.0.1:4100/internal/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "blocked" })
  });
  if (denied.status !== 401) throw new Error("public internal endpoint is not protected");

  const login = await request("http://127.0.0.1:3100/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "founder", password: "phase2-test-password" })
  });
  if (!login.ok) throw new Error("admin login failed");

  const data = await login.json();
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || !data.csrfToken) throw new Error("session material missing");

  const previousAdmin = processes[1];
  const adminStopped = new Promise(resolve => previousAdmin.once("exit", resolve));
  previousAdmin.kill("SIGTERM");
  await adminStopped;
  processes[1] = spawn(process.execPath, ["apps/admin/src/server.js"], { env, stdio: "ignore" });
  const restoredSession = await request("http://127.0.0.1:3100/api/auth/me", { headers: { cookie } });
  const restoredSessionData = await restoredSession.json();
  if (!restoredSession.ok || restoredSessionData.csrfToken !== data.csrfToken) {
    throw new Error("founder session did not persist across restart");
  }

  const activationOverview = await request("http://127.0.0.1:3100/api/control/activation-overview", { headers: { cookie } });
  const overviewData = await activationOverview.json();
  if (!activationOverview.ok || overviewData.overview.pendingRequests !== 1) throw new Error("founder activation overview failed");

  const reviewDenied = await request("http://127.0.0.1:3100/api/control/permit-review", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ requestId: permitData.requestId, decision: "approve", verifiedPermit: true, reason: "Verified" })
  });
  if (reviewDenied.status !== 403) throw new Error("permit review csrf protection failed");

  const unverifiedReview = await request("http://127.0.0.1:3100/api/control/permit-review", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-csrf-token": data.csrfToken },
    body: JSON.stringify({ requestId: permitData.requestId, decision: "approve", verifiedPermit: false, reason: "Not verified" })
  });
  if (unverifiedReview.status !== 400) throw new Error("permit approval bypassed verification gate");

  const approvedReview = await request("http://127.0.0.1:3100/api/control/permit-review", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-csrf-token": data.csrfToken },
    body: JSON.stringify({ requestId: permitData.requestId, decision: "approve", verifiedPermit: true, reason: "Verified by test reviewer" })
  });
  if (!approvedReview.ok) throw new Error("verified permit review failed");

  const authorizedStatus = await request("http://127.0.0.1:4100/api/activation/status?installationId=" + encodeURIComponent(extraInstallationId));
  const authorizedData = await authorizedStatus.json();
  if (!authorizedStatus.ok || authorizedData.installation.status !== "authorized") throw new Error("permit authorization was not applied");

  const revoked = await request("http://127.0.0.1:4100/api/activation/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: extraInstallationId })
  });
  if (!revoked.ok) throw new Error("user revocation failed");

  const me = await request("http://127.0.0.1:3100/api/auth/me", { headers: { cookie } });
  const meData = await me.json();
  if (!me.ok || meData.csrfToken !== data.csrfToken) throw new Error("session restore failed");

  const protectedStatus = await request("http://127.0.0.1:3100/api/control/public-status", { headers: { cookie } });
  if (!protectedStatus.ok) throw new Error("founder public status read failed");

  const control = await request("http://127.0.0.1:3100/api/control/public-config", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": data.csrfToken
    },
    body: JSON.stringify({ message: "controlled by founder" })
  });
  if (!control.ok) throw new Error("admin-to-public control failed");

  const status = await request("http://127.0.0.1:4100/api/public/status");
  const statusData = await status.json();
  if (statusData.config.message !== "controlled by founder") {
    throw new Error("public configuration was not updated");
  }

  const publicBeforeConfigRestart = processes[0];
  const publicConfigStopped = new Promise(resolve => publicBeforeConfigRestart.once("exit", resolve));
  publicBeforeConfigRestart.kill("SIGTERM");
  await publicConfigStopped;
  processes[0] = spawn(process.execPath, ["apps/public/src/server.js"], { env, stdio: "ignore" });
  const persistedStatus = await request("http://127.0.0.1:4100/api/public/status");
  const persistedStatusData = await persistedStatus.json();
  if (!persistedStatus.ok || persistedStatusData.config.message !== "controlled by founder") {
    throw new Error("public configuration did not persist across restart");
  }

  const logout = await request("http://127.0.0.1:3100/api/auth/logout", {
    method: "POST",
    headers: { cookie, "x-csrf-token": data.csrfToken }
  });
  if (!logout.ok) throw new Error("logout failed");

  const adminBeforeLogoutRestart = processes[1];
  const adminLogoutStopped = new Promise(resolve => adminBeforeLogoutRestart.once("exit", resolve));
  adminBeforeLogoutRestart.kill("SIGTERM");
  await adminLogoutStopped;
  processes[1] = spawn(process.execPath, ["apps/admin/src/server.js"], { env, stdio: "ignore" });
  const revokedSession = await request("http://127.0.0.1:3100/api/auth/me", { headers: { cookie } });
  if (revokedSession.status !== 401) throw new Error("logout revocation did not persist");

  console.log("PHASE2_SMOKE_OK");
} finally {
  for (const child of processes) child.kill("SIGTERM");
  await rm(activationStore, { force: true });
  await rm(sessionStore, { force: true });
  await rm(configStore, { force: true });
  await rm(auditStore, { force: true });
}
