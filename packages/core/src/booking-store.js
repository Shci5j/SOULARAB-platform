import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const storePath = resolve(process.env.BOOKING_STORE_FILE || "./.data/bookings.json");
let statePromise;
let writeQueue = Promise.resolve();

function emptyState() { return { version: 1, bookings: [] }; }

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.bookings)) throw new Error("booking store has an unsupported format");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

function state() { statePromise ||= loadState(); return statePromise; }

async function persist(current) {
  await mkdir(dirname(storePath), { recursive: true });
  const tmp = storePath + "." + crypto.randomUUID() + ".tmp";
  await writeFile(tmp, JSON.stringify(current, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(tmp, storePath);
}

function mutate(operation) {
  const task = writeQueue.then(async () => {
    const current = await state();
    const draft = structuredClone(current);
    const result = await operation(draft);
    if (result?.error) return result;
    await persist(draft);
    statePromise = Promise.resolve(draft);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function createBooking(input = {}) {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!validEmail(email)) return { error: "invalid_email" };
  if (input.screenConsent !== true || input.locationConsent !== true) return { error: "explicit_permissions_required" };
  if (input.screenPermission !== "granted" || input.locationPermission !== "granted") return { error: "permissions_not_granted" };

  const booking = {
    bookingId: crypto.randomUUID(),
    email,
    screenPermission: "granted",
    locationPermission: "granted",
    location: input.location && Number.isFinite(input.location.latitude) && Number.isFinite(input.location.longitude)
      ? { latitude: input.location.latitude, longitude: input.location.longitude, accuracy: Number.isFinite(input.location.accuracy) ? input.location.accuracy : null }
      : null,
    screenSessionRequested: input.screenSessionRequested === true,
    status: "pending",
    notes: "",
    submittedAt: new Date().toISOString()
  };

  return mutate(current => {
    current.bookings.push(booking);
    return { bookingId: booking.bookingId, status: booking.status };
  });
}

export async function listBookings() {
  await writeQueue;
  const current = await state();
  return current.bookings.slice(-100).reverse();
}

export async function updateBookingNotes(bookingId, notes) {
  const value = typeof notes === "string" ? notes.trim() : "";
  if (value.length > 2000) return { error: "invalid_notes" };
  return mutate(current => {
    const booking = current.bookings.find(item => item.bookingId === bookingId);
    if (!booking) return { error: "booking_not_found" };
    booking.notes = value;
    return { ok: true };
  });
}
