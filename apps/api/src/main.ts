import { readFile } from "node:fs/promises";

import { AdminAuthService, bootstrapTokenFromPlaintext } from "@mytoken/admin-auth";
import { AdminAuthRepository, ApiKeyRepository, MyTokenDatabase } from "@mytoken/database";

import { createApiApp } from "./app.js";
import { WorkerSocketBackend } from "./worker-socket-backend.js";

const database = new MyTokenDatabase(requiredEnv("MYTOKEN_DB_PATH"));
database.migrate();
const adminRepository = new AdminAuthRepository(database);
const keyRepository = new ApiKeyRepository(database);
const sessionSecret = await readSecret(requiredEnv("MYTOKEN_SESSION_SECRET_FILE"));
const keyPepper = await readSecret(requiredEnv("MYTOKEN_KEY_PEPPER_FILE"));
const adminAuth = new AdminAuthService(adminRepository, sessionSecret);

if (!adminAuth.isInitialized()) {
  const bootstrapPath = requiredEnv("MYTOKEN_BOOTSTRAP_TOKEN_FILE");
  const bootstrapPlaintext = (await readFile(bootstrapPath, "utf8")).trim();
  adminAuth.installBootstrapToken(bootstrapTokenFromPlaintext(bootstrapPlaintext));
}

const backend = new WorkerSocketBackend({
  socketPath: requiredEnv("MYTOKEN_WORKER_SOCKET"),
  requestTimeoutMs: numberEnv("MYTOKEN_REQUEST_TIMEOUT_MS", 120_000),
});
await backend.probe();

const app = await createApiApp({
  backend,
  keyStore: keyRepository,
  keyManagementStore: keyRepository,
  keyPepper,
  adminAuth,
  cookieSecure: process.env.NODE_ENV === "production",
  logger: false,
});
const host = process.env.MYTOKEN_HOST ?? "127.0.0.1";
const port = numberEnv("MYTOKEN_PORT", 8080);
await app.listen({ host, port });
console.log(`MyToken API listening on http://${host}:${String(port)}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  database.close();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

async function readSecret(secretPath: string): Promise<Uint8Array> {
  const value = await readFile(secretPath);
  if (value.byteLength < 32) throw new Error(`Secret file is too short: ${secretPath}`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}
