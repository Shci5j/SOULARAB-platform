import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomToken, requireStrongSecret, timingSafeEqualText } from "../../../packages/core/src/config.js";
import { securityHeaders } from "./security.js";
import { loadPublicConfig, updatePublicConfig } from "../../../packages/core/src/public-config-store.js";
import {
  enrollInstallation,
  getActivationPolicy,
  getFounderActivationOverview,
  getInstallationStatus,
  listPermitRequests,
  reviewPermitRequest,
  revokeInstallation,
  submitPermitRequest
} from "../../../packages/core/src/activation-store.js";

const port = Number(process.env.PUBLIC_PORT || 4000);
const controlToken = requireStrongSecret("SERVICE_CONTROL_TOKEN");
let publicConfig = await loadPublicConfig();

function json(res, status, body, headers = {}) {
  securityHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
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

const server = http.createServer(async (req, res) => {
  const correlationId = req.headers["x-correlation-id"] || randomToken(12);
  try {
    if (req.method === "GET" && ["/", "/styles.css", "/app.js"].includes(req.url)) {
      const asset = req.url === "/" ? "index.html" : req.url.slice(1);
      const types = { "index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8" };
      const content = await readFile(new URL("../web/" + asset, import.meta.url));
      securityHeaders(res);
      res.writeHead(200, { "content-type": types[asset], "cache-control": "no-cache" });
      return res.end(content);
    }
    if (req.method === "GET" && req.url === "/ready") {
      return json(res, 200, { ok: true, service: "public", ready: true, correlationId });
    }
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, service: "public", correlationId });
    }
    if (req.method === "GET" && req.url === "/api/public/status") {
      return json(res, 200, { ok: true, config: publicConfig, correlationId });
    }

    if (req.method === "GET" && req.url === "/api/activation/policy") {
      return json(res, 200, { ok: true, policy: await getActivationPolicy(), correlationId });
    }
    if (req.method === "GET" && req.url.startsWith("/api/activation/status")) {
      const url = new URL(req.url, "http://localhost");
      const status = await getInstallationStatus(url.searchParams.get("installationId"));
      return status
        ? json(res, 200, { ok: true, installation: status, correlationId })
        : json(res, 404, { error: "installation_not_found", correlationId });
    }
    if (req.method === "POST" && req.url === "/api/activation/enroll") {
      const result = await enrollInstallation(await readBody(req));
      if (result.error) return json(res, 400, { error: result.error, correlationId });
      return json(res, result.status === "approval_required" ? 409 : 200, { ok: result.status !== "approval_required", ...result, correlationId });
    }
    if (req.method === "POST" && req.url === "/api/activation/permit-request") {
      const result = await submitPermitRequest(await readBody(req));
      if (result.error) {
        const status = result.error === "trial_slots_still_available" ? 409 : result.error === "pending_request_limit" ? 429 : 400;
        return json(res, status, { error: result.error, correlationId });
      }
      return json(res, 202, { ok: true, ...result, correlationId });
    }
    if (req.method === "POST" && req.url === "/api/activation/revoke") {
      const result = await revokeInstallation((await readBody(req)).installationId);
      if (result.error) return json(res, 404, { error: result.error, correlationId });
      return json(res, 200, { ok: true, ...result, correlationId });
    }

    if (req.url.startsWith("/internal/activation/")) {
      const auth = req.headers.authorization || "";
      const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!timingSafeEqualText(supplied, controlToken)) {
        return json(res, 401, { error: "unauthorized", correlationId });
      }
      if (req.method === "GET" && req.url === "/internal/activation/overview") {
        return json(res, 200, { ok: true, overview: await getFounderActivationOverview(), correlationId });
      }
      if (req.method === "GET" && req.url === "/internal/activation/requests") {
        return json(res, 200, { ok: true, requests: await listPermitRequests(), correlationId });
      }
      if (req.method === "POST" && req.url === "/internal/activation/review") {
        const body = await readBody(req);
        const result = await reviewPermitRequest({ ...body, reviewer: body.reviewer || "founder" });
        if (result.error) {
          const status = result.error === "request_not_found" ? 404 : 400;
          return json(res, status, { error: result.error, correlationId });
        }
        return json(res, 200, { ok: true, ...result, correlationId });
      }
    }
    if (req.method === "POST" && req.url === "/internal/config") {
      const auth = req.headers.authorization || "";
      const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!timingSafeEqualText(supplied, controlToken)) {
        return json(res, 401, { error: "unauthorized", correlationId });
      }
      const body = await readBody(req);
      if (!body || typeof body.message !== "string" || body.message.length > 500) {
        return json(res, 400, { error: "invalid_config", correlationId });
      }
      publicConfig = await updatePublicConfig(body.message);
      if (publicConfig.error) return json(res, 400, { error: publicConfig.error, correlationId });
      return json(res, 200, { ok: true, correlationId });
    }
    return json(res, 404, { error: "not_found", correlationId });
  } catch (error) {
    const status = error.statusCode || 500;
    return json(res, status, {
      error: status === 413 ? "payload_too_large" :
        status === 400 ? "invalid_request" : "internal_error",
      correlationId
    });
  }
});

const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 10_000);
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000) {
  throw new Error("REQUEST_TIMEOUT_MS must be an integer of at least 1000");
}
server.requestTimeout = requestTimeoutMs;
server.headersTimeout = Math.min(requestTimeoutMs, 10_000);
server.keepAliveTimeout = Math.min(requestTimeoutMs, 5_000);
server.listen(port, () => console.log(`public service listening on ${port}`));
