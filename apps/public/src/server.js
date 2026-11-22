import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomToken, requireStrongSecret, timingSafeEqualText } from "../../../packages/core/src/config.js";
import { securityHeaders } from "./security.js";
import { loadPublicConfig } from "../../../packages/core/src/public-config-store.js";
import { createBooking } from "../../../packages/core/src/booking-store.js";
import { createScreenSession, submitOffer, waitForAnswer, closeScreenSession } from "../../../packages/core/src/screen-session-store.js";


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

    if (req.method === "POST" && req.url === "/api/screen-sessions") {
      const body=await readBody(req);
      if(typeof body.bookingId!=="string"||body.bookingId.length<8) {
        return json(res,400,{error:"invalid_session"});
      }
      const session=await createScreenSession(body.bookingId);
      return json(res,201,{ok:true,...session,correlationId});
    }
    if (req.method === "POST" && req.url === "/api/screen-sessions/offer") {
      const body=await readBody(req);
      const result=await submitOffer(body.sessionId,body.sessionSecret,body.offer);
      return json(res,result.error?404:200,result);
    }
    if (req.method === "GET" && req.url.startsWith("/api/screen-sessions/answer")) {
      const u=new URL(req.url,"http://localhost");
      const result=await waitForAnswer(u.searchParams.get("sessionId"),u.searchParams.get("sessionSecret"));
      return json(res,result.error?404:200,result);
    }
    if (req.method === "POST" && req.url === "/api/screen-sessions/close") {
      const body=await readBody(req);
      const result=await closeScreenSession(body.sessionId,body.sessionSecret);
      return json(res,result.error?404:200,result);
    }

    if (req.method === "POST" && req.url === "/api/bookings") {
      const body = await readBody(req);
      const result = await createBooking(body);
      if (result.error) {
        const status = result.error === "invalid_email" ? 400 : 403;
        return json(res, status, { error: result.error, correlationId });
      }
      return json(res, 202, { ok: true, ...result, correlationId });
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
