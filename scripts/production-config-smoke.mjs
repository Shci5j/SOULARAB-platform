const required = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "SERVICE_CONTROL_TOKEN",
  "AUDIT_LOG_SECRET"
];

const failures = [];

if (process.env.NODE_ENV !== "production") failures.push("NODE_ENV must be production");

for (const name of required) {
  if (!process.env[name]?.trim()) failures.push(name + " is required");
}

for (const name of ["ADMIN_SESSION_SECRET", "SERVICE_CONTROL_TOKEN", "AUDIT_LOG_SECRET"]) {
  if ((process.env[name] || "").length < 32) failures.push(name + " must be at least 32 characters");
}

const origin = process.env.ADMIN_ALLOWED_ORIGIN || "";
if (!origin.startsWith("https://")) failures.push("ADMIN_ALLOWED_ORIGIN must use HTTPS");

const publicApi = process.env.PUBLIC_API_URL || "";
if (!publicApi.startsWith("https://")) failures.push("PUBLIC_API_URL must use HTTPS");

if (/localhost|127\.0\.0\.1/.test(origin + publicApi)) failures.push("production endpoints must not point to localhost");

if (failures.length) {
  console.error("Production configuration check failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("Production configuration check passed.");
