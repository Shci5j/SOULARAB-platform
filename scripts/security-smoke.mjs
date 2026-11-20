import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const env = {
  ...process.env,
  NODE_ENV: "production",
  ADMIN_PORT: "3200",
  PUBLIC_PORT: "4200",
  ADMIN_USERNAME: "founder",
  ADMIN_PASSWORD: "security-test-password",
  ADMIN_SESSION_SECRET: "security-test-session-secret-012345678901234567890",
  SERVICE_CONTROL_TOKEN: "security-test-service-token-012345678901234567890",
  PUBLIC_API_URL: "http://127.0.0.1:4200",
  ADMIN_ALLOWED_ORIGIN: "https://admin.example.test",
  REQUEST_TIMEOUT_MS: "5000",
  AUDIT_LOG_FILE: "./.data/security-smoke-audit.log"
};

const children = [
  spawn(process.execPath, ["apps/public/src/server.js"], { env, stdio: "ignore" }),
  spawn(process.execPath, ["apps/admin/src/server.js"], { env, stdio: "ignore" })
];

async function request(url, options = {}) {
  for (let i = 0; i < 40; i++) {
    try { return await fetch(url, options); } catch { await sleep(100); }
  }
  throw new Error("service unavailable");
}

try {
  const adminPage = await request("http://127.0.0.1:3200/");
  if (!adminPage.ok || !adminPage.headers.get("content-security-policy")?.includes("script-src 'self'")) {
    throw new Error("founder interface content security policy failed");
  }
  const publicPage = await request("http://127.0.0.1:4200/");
  if (!publicPage.ok || !publicPage.headers.get("content-security-policy")?.includes("default-src 'none'")) {
    throw new Error("public interface content security policy failed");
  }

  for (const url of ["http://127.0.0.1:3200/ready", "http://127.0.0.1:4200/ready"]) {
    const r = await request(url);
    if (!r.ok) throw new Error("readiness failed");
    if (r.headers.get("x-content-type-options") !== "nosniff") throw new Error("security header missing");
  }

  const deniedOrigin = await request("http://127.0.0.1:3200/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ username: "founder", password: "security-test-password" })
  });
  if (deniedOrigin.status !== 403) throw new Error("origin validation failed");

  const login = await request("http://127.0.0.1:3200/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://admin.example.test" },
    body: JSON.stringify({ username: "founder", password: "security-test-password" })
  });
  if (!login.ok) throw new Error("login failed");
  const data = await login.json();
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  const setCookie = login.headers.get("set-cookie") || "";
  if (!cookie || !data.csrfToken || !setCookie.includes("Secure") || !setCookie.includes("HttpOnly") || !setCookie.includes("SameSite=Strict")) {
    throw new Error("secure session cookie policy failed");
  }

  const csrfDenied = await request("http://127.0.0.1:3200/api/control/public-config", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "https://admin.example.test"
    },
    body: JSON.stringify({ message: "blocked" })
  });
  if (csrfDenied.status !== 403) throw new Error("csrf validation failed");

  const internalDenied = await request("http://127.0.0.1:4200/internal/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "blocked" })
  });
  if (internalDenied.status !== 401) throw new Error("internal boundary exposed");

  const logout = await request("http://127.0.0.1:3200/api/auth/logout", {
    method: "POST",
    headers: { cookie, origin: "https://admin.example.test", "x-csrf-token": data.csrfToken }
  });
  if (!logout.ok) throw new Error("logout failed");

  console.log("SECURITY_SMOKE_OK");
} finally {
  for (const child of children) child.kill("SIGTERM");
}
