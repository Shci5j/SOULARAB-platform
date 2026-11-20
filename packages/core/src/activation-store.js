import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const storePath = resolve(process.env.ACTIVATION_STORE_FILE || "./.data/activation.json");
const trialLimit = 10;
let statePromise;
let writeQueue = Promise.resolve();

function emptyState() {
  return { version: 1, devices: [], requests: [] };
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.devices) || !Array.isArray(parsed.requests)) {
      throw new Error("activation store has an unsupported format");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

function state() {
  statePromise ||= loadState();
  return statePromise;
}

async function persist(current) {
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryPath = storePath + "." + crypto.randomUUID() + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(current, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, storePath);
}

function mutate(operation) {
  const task = writeQueue.then(async () => {
    const current = await state();
    const result = await operation(current);
    await persist(current);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function validInstallationId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function trialCount(current) {
  return current.devices.filter(device => device.enrollmentType === "trial").length;
}

export async function getActivationPolicy() {
  await writeQueue;
  const current = await state();
  const enrolled = trialCount(current);
  return {
    trialLimit,
    trialEnrolled: enrolled,
    trialSlotsAvailable: Math.max(0, trialLimit - enrolled),
    permitRequiredForAdditionalInstallations: enrolled >= trialLimit,
    sensitiveCapabilitiesEnabled: false
  };
}

export async function getInstallationStatus(installationId) {
  if (!validInstallationId(installationId)) return null;
  await writeQueue;
  const current = await state();
  const device = current.devices.find(item => item.installationId === installationId);
  if (!device) return null;
  return {
    installationId: device.installationId,
    status: device.status,
    enrolledAt: device.enrolledAt,
    revokedAt: device.revokedAt || null
  };
}

export async function enrollInstallation({ installationId, consent, consentVersion }) {
  if (!validInstallationId(installationId)) return { error: "invalid_installation_id" };
  if (consent !== true || consentVersion !== "2026-01") return { error: "explicit_consent_required" };
  return mutate(current => {
    const existing = current.devices.find(item => item.installationId === installationId);
    if (existing) return { status: existing.status, existing: true, trialEnrolled: trialCount(current), trialLimit };
    if (trialCount(current) >= trialLimit) {
      return { status: "approval_required", existing: false, trialEnrolled: trialCount(current), trialLimit };
    }
    const device = {
      installationId,
      status: "trial",
      enrollmentType: "trial",
      consentVersion,
      enrolledAt: new Date().toISOString()
    };
    current.devices.push(device);
    return { status: device.status, existing: false, trialEnrolled: trialCount(current), trialLimit };
  });
}

export async function submitPermitRequest(input) {
  const { installationId, authorityName, jurisdiction, permitReference, contactEmail } = input || {};
  if (!validInstallationId(installationId)) return { error: "invalid_installation_id" };
  const fields = [authorityName, jurisdiction, permitReference, contactEmail];
  if (fields.some(value => typeof value !== "string" || !value.trim())) return { error: "missing_permit_details" };
  if (authorityName.length > 160 || jurisdiction.length > 120 || permitReference.length > 120 || contactEmail.length > 254) {
    return { error: "permit_details_too_long" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { error: "invalid_contact_email" };
  return mutate(current => {
    if (trialCount(current) < trialLimit) return { error: "trial_slots_still_available" };
    const device = current.devices.find(item => item.installationId === installationId);
    if (device?.status === "authorized") return { status: "authorized", existing: true };
    const pending = current.requests.find(item => item.installationId === installationId && item.status === "pending");
    if (pending) return { status: "pending", requestId: pending.requestId, existing: true };
    const request = {
      requestId: crypto.randomUUID(),
      installationId,
      authorityName: authorityName.trim(),
      jurisdiction: jurisdiction.trim(),
      permitReference: permitReference.trim(),
      contactEmail: contactEmail.trim(),
      status: "pending",
      submittedAt: new Date().toISOString()
    };
    current.requests.push(request);
    return { status: request.status, requestId: request.requestId, existing: false };
  });
}

export async function getFounderActivationOverview() {
  await writeQueue;
  const current = await state();
  return {
    trialLimit,
    trialEnrolled: trialCount(current),
    authorized: current.devices.filter(item => item.status === "authorized").length,
    revoked: current.devices.filter(item => item.status === "revoked").length,
    pendingRequests: current.requests.filter(item => item.status === "pending").length
  };
}

export async function listPermitRequests() {
  await writeQueue;
  const current = await state();
  return current.requests.slice(-100).reverse().map(({ requestId, installationId, authorityName, jurisdiction, permitReference, contactEmail, status, submittedAt, reviewedAt, decisionReason }) => ({
    requestId, installationId, authorityName, jurisdiction, permitReference, contactEmail, status, submittedAt, reviewedAt, decisionReason
  }));
}

export async function reviewPermitRequest({ requestId, decision, verifiedPermit, reason, reviewer }) {
  if (typeof requestId !== "string" || !["approve", "reject"].includes(decision)) return { error: "invalid_review" };
  if (typeof reason !== "string" || reason.trim().length < 5 || reason.length > 500) return { error: "review_reason_required" };
  if (decision === "approve" && verifiedPermit !== true) return { error: "permit_verification_required" };
  return mutate(current => {
    const request = current.requests.find(item => item.requestId === requestId);
    if (!request) return { error: "request_not_found" };
    if (request.status !== "pending") return { error: "request_already_reviewed" };
    request.status = decision === "approve" ? "approved" : "rejected";
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = reviewer || "founder";
    request.decisionReason = reason.trim();
    if (decision === "approve") {
      let device = current.devices.find(item => item.installationId === request.installationId);
      if (!device) {
        device = {
          installationId: request.installationId,
          enrollmentType: "permit",
          consentVersion: "2026-01",
          enrolledAt: request.submittedAt
        };
        current.devices.push(device);
      }
      device.status = "authorized";
      device.permit = {
        authorityName: request.authorityName,
        jurisdiction: request.jurisdiction,
        permitReference: request.permitReference,
        verifiedBy: request.reviewedBy,
        verifiedAt: request.reviewedAt
      };
    }
    return { status: request.status, installationId: request.installationId };
  });
}

export async function revokeInstallation(installationId) {
  if (!validInstallationId(installationId)) return { error: "invalid_installation_id" };
  return mutate(current => {
    const device = current.devices.find(item => item.installationId === installationId);
    if (!device) return { error: "installation_not_found" };
    if (device.status === "revoked") return { status: "revoked", existing: true };
    device.status = "revoked";
    device.revokedAt = new Date().toISOString();
    return { status: "revoked", existing: false };
  });
}
