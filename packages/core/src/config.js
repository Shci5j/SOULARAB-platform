import crypto from "node:crypto";

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

export function requireStrongSecret(name, minimumLength = 32) {
  const value = requireEnv(name);
  if (value.length < minimumLength) {
    throw new Error(`${name} must be at least ${minimumLength} characters`);
  }
  return value;
}

export function timingSafeEqualText(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
