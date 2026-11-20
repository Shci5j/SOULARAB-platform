import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";

const storePath = resolve(process.env.PUBLIC_CONFIG_FILE || "./.data/public-config.json");
const defaultConfig = { status: "online", message: "SOULARAB public platform" };
let configPromise;
let writeQueue = Promise.resolve();

async function load() {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8"));
    if (parsed?.status !== "online" || typeof parsed.message !== "string" || parsed.message.length > 500) {
      throw new Error("public config store has an invalid format");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return { ...defaultConfig };
    throw error;
  }
}

export async function loadPublicConfig() {
  configPromise ||= load();
  return { ...(await configPromise) };
}

export async function updatePublicConfig(message) {
  if (typeof message !== "string" || message.length > 500) {
    return { error: "invalid_config" };
  }
  const task = writeQueue.then(async () => {
    await loadPublicConfig();
    const next = { status: "online", message };
    await mkdir(dirname(storePath), { recursive: true });
    const temporaryPath = storePath + "." + crypto.randomUUID() + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(next, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporaryPath, storePath);
    configPromise = Promise.resolve(next);
    return { ...next };
  });
  writeQueue = task.catch(() => {});
  return task;
}
