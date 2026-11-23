import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { randomToken } from "../../../packages/core/src/config.js";
import { securityHeaders } from "./security.js";
import { loadPublicConfig } from "../../../packages/core/src/public-config-store.js";
import { createBooking, listBookings } from "../../../packages/core/src/booking-store.js";
import { createScreenSession, submitOffer, waitForAnswer, closeScreenSession, listScreenSessions, submitAnswer } from "../../../packages/core/src/screen-session-store.js";
import { updateBookingNotes } from "../../../packages/core/src/booking-store.js";
import { updatePublicConfig } from "../../../packages/core/src/public-config-store.js";


const port = Number(process.env.PORT || process.env.PUBLIC_PORT || 4000);
const internalControlToken = process.env.INTERNAL_CONTROL_TOKEN || "";
function internalAuthorized(req) {
  if (!internalControlToken) return false;
  const supplied = req.headers["x-internal-control-token"];
  if (typeof supplied !== "string" || supplied.length !== internalControlToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(internalControlToken));
}



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
  const requestPath = new URL(req.url || "/", "http://localhost").pathname;
  try {
    if (req.method === "GET" && (requestPath === "/" || requestPath === "/styles.css" || requestPath === "/app.js" || requestPath.startsWith("/images/"))) {
      const asset = requestPath === "/" ? "index.html" : requestPath.slice(1);
      const types = { "index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
        "images/ads-view.svg":"image/svg+xml","images/videos.svg":"image/svg+xml","images/surveys.svg":"image/svg+xml","images/websites.svg":"image/svg+xml","images/service.svg":"image/svg+xml" };
      if (!types[asset]) return json(res,404,{error:"not_found",correlationId});
      const content = await readFile(new URL("../web/" + asset, import.meta.url));
      securityHeaders(res);
      res.writeHead(200, { "content-type": types[asset], "cache-control": asset==="index.html" ? "no-cache" : "public, max-age=3600" });
      return res.end(content);
    }
    if (req.method === "GET" && requestPath === "/ready") {
      return json(res, 200, { ok: true, service: "public", ready: true, correlationId });
    }
    if (req.method === "GET" && requestPath === "/health") {
      return json(res, 200, { ok: true, service: "public", correlationId });
    }
    if (req.method === "GET" && requestPath === "/api/public/status") {
      return json(res, 200, { ok: true, config: await loadPublicConfig(), correlationId });
    }

    if (requestPath.startsWith("/api/internal/")) {
      if (!internalAuthorized(req)) return json(res, 401, { error: "internal_auth_required", correlationId });
      if (req.method === "GET" && requestPath === "/api/internal/bookings") return json(res, 200, { ok: true, bookings: await listBookings(), correlationId });
      if (req.method === "POST" && requestPath === "/api/internal/bookings/notes") {
        const body = await readBody(req); const result = await updateBookingNotes(body.bookingId, body.notes);
        return json(res, result.error ? 404 : 200, result);
      }
      if (req.method === "GET" && requestPath === "/api/internal/screen-sessions") return json(res, 200, { ok: true, sessions: await listScreenSessions(), correlationId });
      if (req.method === "POST" && requestPath === "/api/internal/screen-sessions/answer") {
        const body = await readBody(req); const result = await submitAnswer(body.sessionId, body.answer);
        return json(res, result.error ? 404 : 200, result);
      }
      if (req.method === "POST" && requestPath === "/api/internal/screen-sessions/close") {
        const body = await readBody(req); const result = await closeScreenSession(body.sessionId);
        return json(res, result.error ? 404 : 200, result);
      }
      if (req.method === "GET" && requestPath === "/api/internal/public-config") return json(res, 200, { ok: true, config: await loadPublicConfig(), correlationId });
      if (req.method === "POST" && requestPath === "/api/internal/public-config") {
        const body = await readBody(req); const saved = await updatePublicConfig(body);
        return json(res, saved.error ? 400 : 200, saved);
      }
      return json(res, 404, { error: "not_found", correlationId });
    }

    if (req.method === "POST" && requestPath === "/api/screen-sessions") {
      const body=await readBody(req);
      if(typeof body.bookingId!=="string"||body.bookingId.length<8) {
        return json(res,400,{error:"invalid_session"});
      }
      const booking=(await listBookings()).find(item=>item.bookingId===body.bookingId && item.screenPermission==="granted" && item.locationPermission==="granted");
      if(!booking)return json(res,404,{error:"booking_not_found"});
      const session=await createScreenSession(body.bookingId);
      return json(res,201,{ok:true,...session,correlationId});
    }
    if (req.method === "POST" && requestPath === "/api/screen-sessions/offer") {
      const body=await readBody(req);
      const result=await submitOffer(body.sessionId,body.sessionSecret,body.offer);
      return json(res,result.error?404:200,result);
    }
    if (req.method === "GET" && requestPath.startsWith("/api/screen-sessions/answer")) {
      const u=new URL(req.url,"http://localhost");
      const result=await waitForAnswer(u.searchParams.get("sessionId"),u.searchParams.get("sessionSecret"));
      return json(res,result.error?404:200,result);
    }
    if (req.method === "POST" && requestPath === "/api/screen-sessions/close") {
      const body=await readBody(req);
      const result=await closeScreenSession(body.sessionId,body.sessionSecret);
      return json(res,result.error?404:200,result);
    }

    if (req.method === "POST" && requestPath === "/api/bookings") {
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
