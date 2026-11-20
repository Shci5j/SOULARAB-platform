import { mkdir, copyFile, access } from "node:fs/promises";
import { resolve, basename } from "node:path";

const files = [
  process.env.SESSION_STORE_FILE,
  process.env.AUDIT_LOG_FILE,
  process.env.ACTIVATION_STORE_FILE,
  process.env.PUBLIC_CONFIG_FILE
].filter(Boolean);

const destination = resolve(process.env.BACKUP_DIR || "./.backups", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(destination, { recursive: true });

let copied = 0;
for (const source of files) {
  try {
    await access(source);
    await copyFile(source, resolve(destination, basename(source)));
    copied += 1;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

console.log(JSON.stringify({ destination, configuredFiles: files.length, copied }, null, 2));
if (copied === 0) process.exit(1);
