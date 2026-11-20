import http from "node:http";
import { randomToken, requireStrongSecret, timingSafeEqualText } from "../../../packages/core/src/config.js";

const port = Number(process.env.PUBLIC_PORT || 4000);
const controlToken = requireStrongSecret("SERVICE_CONTROL_TOKEN");
let publicConfig = { status: "online", message: "SOULARAB public platform" };

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  if (raw.length > 16_384) throw new Error("request body too large");
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const correlationId = req.headers["x-correlation-id"] || randomToken(12);

  try {
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
    return json(res, 500, { error: "internal_error", correlationId });
  }
});

server.listen(port, () => {
  console.log(`public service listening on ${port}`);
});
