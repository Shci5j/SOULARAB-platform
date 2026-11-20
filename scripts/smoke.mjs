import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const env = {
  ...process.env,
  ADMIN_PORT: "3100",
  PUBLIC_PORT: "4100",
  ADMIN_USERNAME: "founder",
  ADMIN_PASSWORD: "phase2-test-password",
  ADMIN_SESSION_SECRET: "phase2-session-secret-01234567890123456789",
  SERVICE_CONTROL_TOKEN: "phase2-service-token-01234567890123456789",
  PUBLIC_API_URL: "http://127.0.0.1:4100",
  AUDIT_LOG_FILE: "./.data/smoke-audit.log"
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

  console.log("PHASE2_SMOKE_OK");
} finally {
  for (const child of processes) child.kill("SIGTERM");
}
