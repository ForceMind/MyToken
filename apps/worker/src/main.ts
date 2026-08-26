import { chmod, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { CodexAppServerClient } from "./app-server/client.js";
import { CodexResponseCoordinator } from "./gateway/codex-response-coordinator.js";
import { createWorkerInternalApp } from "./internal-app.js";
import { OpenClawToolBroker } from "./tool-bridge/openclaw-tool-broker.js";

const codexBin = process.env.MYTOKEN_CODEX_BIN ?? "codex";
const codexHome = requiredEnv("MYTOKEN_CODEX_HOME");
const workspace = requiredEnv("MYTOKEN_CODEX_WORKSPACE");
const socketPath = requiredEnv("MYTOKEN_WORKER_SOCKET");
const version = process.env.MYTOKEN_VERSION ?? "0.1.0";
const supportedCodexVersion = requiredEnv("MYTOKEN_SUPPORTED_CODEX_VERSION");
const allowUnverifiedCodexVersion = booleanEnv("MYTOKEN_ALLOW_UNVERIFIED_CODEX_VERSION", false);
const enableClientTools = booleanEnv("MYTOKEN_ENABLE_EXPERIMENTAL_TOOL_BRIDGE", false);

await mkdir(codexHome, { recursive: true, mode: 0o700 });
await mkdir(workspace, { recursive: true, mode: 0o700 });
await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o750 });

const detectedCodexVersion = await detectCodexVersion(codexBin, codexHome);
if (detectedCodexVersion !== supportedCodexVersion && !allowUnverifiedCodexVersion) {
  throw new Error(
    `Unsupported Codex version ${detectedCodexVersion}; expected ${supportedCodexVersion}`,
  );
}

const client = new CodexAppServerClient({
  command: codexBin,
  args: ["app-server", "--stdio"],
  cwd: workspace,
  env: minimalCodexEnvironment(codexHome),
  requestTimeoutMs: numberEnv("MYTOKEN_REQUEST_TIMEOUT_MS", 120_000),
});
const broker = new OpenClawToolBroker({
  resultTimeoutMs: numberEnv("MYTOKEN_TOOL_RESULT_TIMEOUT_MS", 300_000),
  maxPendingCalls: numberEnv("MYTOKEN_MAX_PENDING_TOOL_CALLS", 8),
  maxResultBytes: numberEnv("MYTOKEN_MAX_TOOL_RESULT_BYTES", 1024 * 1024),
});
broker.attach(client);
const coordinator = new CodexResponseCoordinator(client, broker, {
  responseTimeoutMs: numberEnv("MYTOKEN_REQUEST_TIMEOUT_MS", 120_000),
  workspace,
  enableClientTools,
});
await client.start({
  clientInfo: { name: "mytoken_gateway", title: "MyToken Gateway", version },
  experimentalApi: enableClientTools,
});

const app = createWorkerInternalApp({ client, coordinator, version });
await app.listen({ path: socketPath });
await chmod(socketPath, 0o660);
console.log(`MyToken worker ready on Unix socket ${socketPath}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  client.stop();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
client.on("childFailure", () => {
  broker.invalidateGeneration(client.generation);
  process.exitCode = 1;
  void shutdown();
});

function minimalCodexEnvironment(codexHomePath: string): NodeJS.ProcessEnv {
  const allowed = ["PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "CODEX_CA_CERTIFICATE"] as const;
  const environment: NodeJS.ProcessEnv = {
    HOME: codexHomePath,
    CODEX_HOME: codexHomePath,
  };
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
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

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Environment variable ${name} must be true or false`);
}

async function detectCodexVersion(command: string, codexHomePath: string): Promise<string> {
  const execute = promisify(execFile);
  const result = await execute(command, ["--version"], {
    env: minimalCodexEnvironment(codexHomePath),
    timeout: 10_000,
  });
  const match = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u.exec(result.stdout.trim());
  if (!match?.[1]) throw new Error("Unable to determine Codex CLI version");
  return match[1];
}
