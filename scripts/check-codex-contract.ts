import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface Manifest {
  codexVersion: string;
  schemaSha256: string;
  methods: Record<string, string>;
}

const codexBin = process.env.MYTOKEN_CODEX_BIN ?? "codex";
const versionOutput = execFileSync(codexBin, ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const version = /([0-9]+\.[0-9]+\.[0-9]+)$/u.exec(versionOutput)?.[1];
if (!version) throw new Error(`Could not parse Codex version: ${versionOutput}`);

const contractRoot = path.resolve("contracts", "codex", version);
const manifest = JSON.parse(
  await readFile(path.join(contractRoot, "manifest.json"), "utf8"),
) as Manifest;

if (manifest.codexVersion !== version) {
  throw new Error(`Contract version ${manifest.codexVersion} does not match installed ${version}`);
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, absolute)));
    else if (entry.isFile() && entry.name !== "manifest.json")
      files.push(path.relative(root, absolute));
  }
  return files;
}

const hash = createHash("sha256");
for (const relative of await collectFiles(contractRoot)) {
  hash.update(relative);
  hash.update("\0");
  hash.update(await readFile(path.join(contractRoot, relative)));
  hash.update("\0");
}
const actualHash = hash.digest("hex");
if (actualHash !== manifest.schemaSha256) {
  throw new Error(`Contract hash mismatch: expected ${manifest.schemaSha256}, got ${actualHash}`);
}

for (const method of ["thread/start.dynamicTools", "item/tool/call"]) {
  if (manifest.methods[method] !== "schema-verified") {
    throw new Error(`Required OpenClaw bridge capability is not schema-verified: ${method}`);
  }
}

console.log(`Codex contract OK: version=${version} sha256=${actualHash}`);
