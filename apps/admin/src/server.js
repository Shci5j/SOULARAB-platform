import http from "node:http";
import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import {
  randomToken,
  requireEnv,
  requireStrongSecret,
  timingSafeEqualText
} from "../../../packages/core/src/config.js";
import { writeAuditEvent } from "../../../packages/core/src/audit.js";
import { securityHeaders, assertSafeOrigin } from "./security.js";

const port = Number(process.env.ADMIN_PORT || 3000);
const adminUser = requireEnv("ADMIN_USERNAME");
const adminPassword = requireStrongSecret("ADMIN_PASSWORD", 16);
const sessionSecret = requireStrongSecret("ADMIN_SESSION_SECRET");
const serviceToken = requireStrongSecret("SERVICE_CONTROL_TOKEN");
const publicApiUrl = process.env.PUBLIC_API_URL || "http://127.0.0.1:4000";
const allowedOrigin = process.env.ADMIN_ALLOWED_ORIGIN || "";
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 10_000);
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000) {
  throw new Error("REQUEST_TIMEOUT_MS must be an integer of at least 1000");
}
const sessions = new Map();
const attempts = new Map();

await mkdir("./.data", { recursive: true });

function json(res, status, body, headers = {}) {
  securityHeaders(res);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

function signSession(token) {
  return crypto.createHmac("sha256", sessionSecret).update(token).digest("base64url");
}

function cookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf("=");
    return i === -1 ? [v, ""] : [v.slice(0, i), v.slice(i + 1)];
  }));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) {
      tooLarge = true;
      continue;
    }
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) {
    const error = new Error("request body too large");
    error.statusCode = 413;
    throw error;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function rateLimited(req) {
  const key = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const list = (attempts.get(key) || []).filter(t => now - t < 60_000);
  if (list.length >= 10) {
    attempts.set(key, list);
    return true;
  }
  list.push(now);
  attempts.set(key, list);
  return false;
}

function sessionFrom(req) {
  const raw = parseCookies(req.headers.cookie).soularab_admin;
  if (!raw) return null;
  const [token, signature] = raw.split(".");
  if (!token || !signature || !timingSafeEqualText(signature, signSession(token))) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireFounder(req, res) {
  const session = sessionFrom(req);
  if (!session || session.role !== "founder") {
    json(res, 401, { error: "authentication_required" });
    return null;
  }
  return session;
}

async function audit(req, action, result, metadata = {}) {
  return writeAuditEvent({
    actor: sessionFrom(req)?.username || "anonymous",
    action,
    target: "admin-control-plane",
    result,
    correlationId: req.headers["x-correlation-id"] || randomToken(12),
    metadata
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!assertSafeOrigin(req, allowedOrigin)) {
      await audit(req, "request.origin", "denied");
      return json(res, 403, { error: "origin_denied" });
    }

    if (req.method === "GET" && ["/", "/styles.css", "/app.js"].includes(req.url)) {
      const asset = req.url === "/" ? "index.html" : req.url.slice(1);
      const types = { "index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8" };
      const content = await readFile(new URL("../web/" + asset, import.meta.url));
      securityHeaders(res);
      res.writeHead(200, { "content-type": types[asset], "cache-control": "no-cache" });
      return res.end(content);
    }

    if (req.method === "GET" && req.url === "/ready") {
      return json(res, 200, { ok: true, service: "admin", ready: true });
    }

    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, service: "admin" });
    }

    if (req.method === "POST" && req.url === "/api/auth/login") {
      if (rateLimited(req)) {
        await audit(req, "auth.login", "rate_limited");
        return json(res, 429, { error: "too_many_attempts" });
      }
      const body = await readBody(req);
      const valid = body.username === adminUser &&
        timingSafeEqualText(String(body.password || ""), adminPassword);
      if (!valid) {
        await audit(req, "auth.login", "denied");
        return json(res, 401, { error: "invalid_credentials" });
      }
      const token = randomToken(48);
      const csrf = randomToken(32);
      sessions.set(token, {
        username: adminUser,
        role: "founder",
        csrf,
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      });
      await audit(req, "auth.login", "success");
      return json(res, 200, {
        ok: true,
        user: { username: adminUser, role: "founder" },
        csrfToken: csrf
      }, {
        "set-cookie": cookie("soularab_admin", `${token}.${signSession(token)}`, 8 * 60 * 60)
      });
    }

    if (req.method === "POST" && req.url === "/api/auth/logout") {
      const session = requireFounder(req, res);
      if (!session) return;
      if (req.headers["x-csrf-token"] !== session.csrf) {
        await audit(req, "auth.logout", "csrf_denied");
        return json(res, 403, { error: "csrf_denied" });
      }
      sessions.delete(session.token);
      await audit(req, "auth.logout", "success");
      return json(res, 200, { ok: true }, { "set-cookie": cookie("soularab_admin", "", 0) });
    }

    if (req.method === "GET" && req.url === "/api/auth/me") {
      const session = requireFounder(req, res);
      if (!session) return;
      return json(res, 200, { ok: true, user: { username: session.username, role: session.role }, csrfToken: session.csrf });
    }

    if (req.method === "GET" && req.url === "/api/control/public-status") {
      const session = requireFounder(req, res);
      if (!session) return;
      try {
        const upstream = await fetch(publicApiUrl + "/api/public/status", {
          headers: { "x-correlation-id": req.headers["x-correlation-id"] || crypto.randomUUID() }
        });
        if (!upstream.ok) return json(res, 502, { error: "public_service_unavailable" });
        const data = await upstream.json();
        return json(res, 200, { ok: true, config: data.config });
      } catch {
        return json(res, 502, { error: "public_service_unavailable" });
      }
    }

    if (req.method === "POST" && req.url === "/api/control/public-config") {
      const session = requireFounder(req, res);
      if (!session) return;
      if (req.headers["x-csrf-token"] !== session.csrf) {
        await audit(req, "control.public-config", "csrf_denied");
        return json(res, 403, { error: "csrf_denied" });
      }
      const body = await readBody(req);
      if (!body || typeof body.message !== "string" || body.message.length > 500) {
        await audit(req, "control.public-config", "invalid_input");
        return json(res, 400, { error: "invalid_input" });
      }
      const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();
      const upstream = await fetch(`${publicApiUrl}/internal/config`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${serviceToken}`,
          "x-correlation-id": correlationId
        },
        body: JSON.stringify({ message: body.message })
      });
      if (!upstream.ok) {
        await audit(req, "control.public-config", "upstream_denied", { status: upstream.status, correlationId });
        return json(res, 502, { error: "public_service_unavailable", correlationId });
      }
      await audit(req, "control.public-config", "success", { correlationId });
      return json(res, 200, { ok: true, correlationId });
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    await audit(req, "request", "error", { message: error.message });
    return json(res, error.statusCode || 500, {
      error: error.statusCode === 413 ? "payload_too_large" :
        error.statusCode === 400 ? "invalid_request" : "internal_error"
    });
  }
});

server.requestTimeout = requestTimeoutMs;
server.headersTimeout = Math.min(requestTimeoutMs, 10_000);
server.keepAliveTimeout = Math.min(requestTimeoutMs, 5_000);
server.listen(port, () => console.log(`admin service listening on ${port}`));
