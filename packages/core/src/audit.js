import { appendFile } from "node:fs/promises";

export async function writeAuditEvent({
  actor,
  action,
  target,
  result,
  correlationId,
  metadata = {}
}) {
  const event = {
    actor,
    action,
    target,
    timestamp: new Date().toISOString(),
    result,
    correlationId,
    metadata
  };

  const path = process.env.AUDIT_LOG_FILE || "./.data/audit.log";
  await appendFile(path, JSON.stringify(event) + "\n", "utf8");
  return event;
}
