import http from "node:http";
import { randomToken, requireStrongSecret, timingSafeEqualText } from "../../../packages/core/src/config.js";
import { securityHeaders } from "./security.js";

const port = Number(process.env.PUBLIC_PORT || 4000);
const controlToken = requireStrongSecret("SERVICE_CONTROL_TOKEN");
let publicConfig = { status: "online", message: "SOULARAB public platform" };

function json(res, status, body, headers = {}) {
  securityHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
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
    if (req.method === "GET" && req.url === "/ready") {
      return json(res, 200, { ok: true, service: "public", ready: true, correlationId });
    }
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, service: "public", correlationId });
    }
    if (req.method === "GET" && req.url === "/api/public/status") {
      return json(res, 200, { ok: true, config: publicConfig, correlationId });
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
      publicConfig = { status: "online", message: body.message };
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
