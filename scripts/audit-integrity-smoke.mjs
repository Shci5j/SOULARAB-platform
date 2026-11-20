import assert from "node:assert/strict";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";

const secret = "audit-integrity-test-secret-01234567890123456789";
const signedPath = join(tmpdir(), "soularab-audit-signed-" + crypto.randomUUID() + ".jsonl");
const legacyPath = join(tmpdir(), "soularab-audit-legacy-" + crypto.randomUUID() + ".jsonl");
process.env.AUDIT_LOG_SECRET = secret;

try {
  process.env.AUDIT_LOG_FILE = signedPath;
  const signed = await import("../packages/core/src/audit.js?case=signed-" + crypto.randomUUID());
  await signed.writeAuditEvent({
    actor: "test",
    action: "test.first",
    target: "audit",
    result: "success",
    correlationId: crypto.randomUUID()
  });
  await signed.writeAuditEvent({
    actor: "test",
    action: "test.second",
    target: "audit",
    result: "success",
    correlationId: crypto.randomUUID()
  });
  const valid = await signed.verifyAuditLog();
  assert.equal(valid.ok, true);
  assert.equal(valid.signedEventCount, 2);
  assert.equal((await signed.readAuditEvents(10)).length, 2);

  const lines = (await readFile(signedPath, "utf8")).trim().split("\n");
  const first = JSON.parse(lines[0]);
  first.action = "tampered.action";
  lines[0] = JSON.stringify(first);
  await writeFile(signedPath, lines.join("\n") + "\n", "utf8");
  const tampered = await signed.verifyAuditLog();
  assert.equal(tampered.ok, false);
  await assert.rejects(() => signed.writeAuditEvent({
    actor: "test",
    action: "test.after-tamper",
    target: "audit",
    result: "success",
    correlationId: crypto.randomUUID()
  }));

  process.env.AUDIT_LOG_FILE = legacyPath;
  await writeFile(legacyPath, JSON.stringify({
    actor: "legacy",
    action: "legacy.event",
    target: "audit",
    timestamp: new Date().toISOString(),
    result: "success",
    correlationId: "legacy"
  }) + "\n", "utf8");
  const legacy = await import("../packages/core/src/audit.js?case=legacy-" + crypto.randomUUID());
  await legacy.writeAuditEvent({
    actor: "test",
    action: "test.after-legacy",
    target: "audit",
    result: "success",
    correlationId: crypto.randomUUID()
  });
  const compatible = await legacy.verifyAuditLog();
  assert.equal(compatible.ok, true);
  assert.equal(compatible.legacyEventCount, 1);
  assert.equal(compatible.signedEventCount, 1);
  console.log("AUDIT_INTEGRITY_SMOKE_OK");
} finally {
  await rm(signedPath, { force: true });
  await rm(legacyPath, { force: true });
}
