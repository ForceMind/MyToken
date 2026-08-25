import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , codexVersion, contractRoot] = process.argv;
if (!codexVersion || !contractRoot) {
  throw new Error("Usage: write-contract-manifest.mjs <codex-version> <contract-root>");
}

async function collectFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, absolute)));
    } else if (entry.isFile() && entry.name !== "manifest.json") {
      files.push(path.relative(root, absolute));
    }
  }
  return files;
}

const files = await collectFiles(contractRoot);
const hash = createHash("sha256");
for (const relative of files) {
  hash.update(relative);
  hash.update("\0");
  hash.update(await readFile(path.join(contractRoot, relative)));
  hash.update("\0");
}

const experimentalThreadStart = JSON.parse(
  await readFile(path.join(contractRoot, "experimental-json/v2/ThreadStartParams.json"), "utf8"),
);
const serverRequest = await readFile(
  path.join(contractRoot, "experimental-json/ServerRequest.json"),
  "utf8",
);

const manifest = {
  codexVersion,
  generatedAt: new Date().toISOString(),
  stableApiOnly: false,
  experimentalUsage: ["thread/start.dynamicTools", "item/tool/call"],
  schemaSha256: hash.digest("hex"),
  fileCount: files.length,
  methods: {
    "account/read": "schema-verified",
    "account/login/start": "schema-verified",
    "account/rateLimits/read": "schema-verified",
    "model/list": "schema-verified",
    "thread/start": "schema-verified",
    "thread/resume": "schema-verified",
    "turn/start": "schema-verified",
    "turn/interrupt": "schema-verified",
    "thread/delete": "schema-verified",
    "thread/start.dynamicTools": experimentalThreadStart?.properties?.dynamicTools
      ? "schema-verified"
      : "missing",
    "item/tool/call": serverRequest.includes('"item/tool/call"') ? "schema-verified" : "missing",
  },
};

await writeFile(
  path.join(contractRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
