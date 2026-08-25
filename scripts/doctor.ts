import { execFileSync } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";

function safeCommand(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

const codexBin = process.env.MYTOKEN_CODEX_BIN ?? "codex";
const codexVersion = safeCommand(codexBin, ["--version"]);
const version = /([0-9]+\.[0-9]+\.[0-9]+)$/u.exec(codexVersion)?.[1];
let contract = "missing";
if (version) {
  const manifestPath = path.resolve("contracts", "codex", version, "manifest.json");
  try {
    await access(manifestPath, constants.R_OK);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schemaSha256?: string;
    };
    contract = manifest.schemaSha256 ? `present:${manifest.schemaSha256}` : "invalid";
  } catch {
    contract = "missing";
  }
}

const report = {
  node: process.version,
  npm: safeCommand("npm", ["--version"]),
  codex: codexVersion,
  codexContract: contract,
  platform: process.platform,
  systemd: safeCommand("systemctl", ["--version"]).split("\n")[0],
  experimentalToolBridgeRequested: process.env.MYTOKEN_ENABLE_EXPERIMENTAL_TOOL_BRIDGE === "true",
};

console.log(JSON.stringify(report, null, 2));
