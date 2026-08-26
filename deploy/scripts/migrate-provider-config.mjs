#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const [legacyPath, samplePath, destinationPath, secretDirectory] = process.argv.slice(2);
if (!legacyPath || !samplePath || !destinationPath || !secretDirectory) {
  throw new Error("legacy, sample, destination and secret directory paths are required");
}

await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
await mkdir(secretDirectory, { recursive: true, mode: 0o700 });

const sourcePath = (await exists(legacyPath)) ? legacyPath : samplePath;
const decoded = JSON.parse(await readFile(sourcePath, "utf8"));
if (!decoded || !Array.isArray(decoded.providers)) throw new Error("Invalid provider config");

for (const provider of decoded.providers) {
  if (
    !provider ||
    typeof provider.id !== "string" ||
    !/^[a-z][a-z0-9_-]{1,31}$/u.test(provider.id)
  ) {
    throw new Error("Invalid provider id in legacy config");
  }
  const managedSecret = path.join(secretDirectory, provider.id);
  if (
    typeof provider.apiKeyFile === "string" &&
    provider.apiKeyFile !== managedSecret &&
    (await exists(provider.apiKeyFile)) &&
    !(await exists(managedSecret))
  ) {
    await copyFile(provider.apiKeyFile, managedSecret);
    await chmod(managedSecret, 0o600);
  }
  provider.apiKeyFile = managedSecret;
  if (provider.id === "deepseek" && provider.protocol === "openai-responses") {
    provider.protocol = "openai-chat";
  }
}

const temporary = `${destinationPath}.tmp.${process.pid}`;
await writeFile(temporary, `${JSON.stringify(decoded, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await rename(temporary, destinationPath);

async function exists(value) {
  try {
    await stat(value);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}
