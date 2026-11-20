import crypto from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { requireStrongSecret, timingSafeEqualText } from "./config.js";

const auditSecret = requireStrongSecret("AUDIT_LOG_SECRET");
const auditPath = resolve(process.env.AUDIT_LOG_FILE || "./.data/audit.log");
let writeQueue = Promise.resolve();

function hmac(payload) {
  return crypto.createHmac("sha256", auditSecret).update(JSON.stringify(payload)).digest("hex");
}

async function inspectLog() {
  let raw;
  try {
    raw = await readFile(auditPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: true, events: [], sequence: 0, lastHash: "GENESIS", legacyCount: 0 };
    }
    throw error;
  }

  const lines = raw.split("\n").filter(Boolean);
  let sequence = 0;
  let lastHash = "GENESIS";
  let legacyCount = 0;
  const events = [];

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { ok: false, reason: "invalid_json", events, sequence, lastHash, legacyCount };
    }

    if (!Object.hasOwn(event, "hash") && !Object.hasOwn(event, "sequence")) {
      if (sequence > 0) return { ok: false, reason: "legacy_event_after_signed_event", events, sequence, lastHash, legacyCount };
      legacyCount += 1;
      lastHash = "LEGACY:" + crypto.createHash("sha256").update(line).digest("hex");
      events.push(event);
      continue;
    }

    const { hash, ...payload } = event;
    if (!Number.isSafeInteger(event.sequence) ||
        event.sequence !== sequence + 1 ||
        event.previousHash !== lastHash ||
        typeof hash !== "string" ||
        !timingSafeEqualText(hash, hmac(payload))) {
      return { ok: false, reason: "chain_integrity_failed", events, sequence, lastHash, legacyCount };
    }
    sequence = event.sequence;
    lastHash = hash;
    events.push(event);
  }

  return { ok: true, events, sequence, lastHash, legacyCount };
}

export async function verifyAuditLog() {
  await writeQueue;
  const state = await inspectLog();
  return {
    ok: state.ok,
    reason: state.reason || null,
    eventCount: state.events.length,
    signedEventCount: state.sequence,
    legacyEventCount: state.legacyCount,
    lastHash: state.lastHash
  };
}

export async function readAuditEvents(limit = 50) {
  await writeQueue;
  const state = await inspectLog();
  if (!state.ok) throw new Error("audit log integrity verification failed");
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
  return state.events.slice(-safeLimit).reverse();
}

export async function writeAuditEvent({
  actor,
  action,
  target,
  result,
  correlationId,
  metadata = {}
}) {
  const task = writeQueue.then(async () => {
    const state = await inspectLog();
    if (!state.ok) throw new Error("audit log integrity verification failed");
    const payload = {
      sequence: state.sequence + 1,
      actor,
      action,
      target,
      timestamp: new Date().toISOString(),
      result,
      correlationId,
      metadata,
      previousHash: state.lastHash
    };
    const event = { ...payload, hash: hmac(payload) };
    await mkdir(dirname(auditPath), { recursive: true });
    await appendFile(auditPath, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
    return event;
  });
  writeQueue = task.catch(() => {});
  return task;
}
