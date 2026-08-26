#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = packageJson.version;
const defaults = {
  repository: "https://github.com/ForceMind/MyToken.git",
  ref: `v${version}`,
  source: "/srv/mytoken-src",
};

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const options = parseOptions(args.slice(1));

try {
  switch (command) {
    case "install":
      requireRoot();
      requireLinux();
      installPrerequisites();
      await ensureSource(options);
      runInstaller(options);
      break;
    case "update":
      requireRoot();
      requireLinux();
      installPrerequisites();
      await updateSource(options);
      runInstaller(options);
      break;
    case "status":
    case "doctor":
    case "health":
    case "ready":
    case "backup":
    case "codex-status":
    case "codex-login":
    case "provider-status":
    case "provider-reload":
      delegate(command);
      break;
    case "handoff":
      printHandoff(options.source);
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(version);
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`mytoken-gateway: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function parseOptions(values) {
  const parsed = { ...defaults };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (!["--source", "--ref", "--repo"].includes(flag) || !value) {
      throw new Error(`Invalid option: ${flag ?? ""}`);
    }
    if (flag === "--source") parsed.source = path.resolve(value);
    if (flag === "--ref") parsed.ref = value;
    if (flag === "--repo") parsed.repository = value;
    index += 1;
  }
  return parsed;
}

function requireRoot() {
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error(
      "Installation changes system users and services. Run: sudo npx --yes mytoken-gateway@preview install",
    );
  }
}

function requireLinux() {
  if (process.platform !== "linux" || !existsSync("/run/systemd/system")) {
    throw new Error("The deployment command requires a Linux server running systemd");
  }
}

function installPrerequisites() {
  const required = [
    "git",
    "curl",
    "openssl",
    "rsync",
    "systemctl",
    "runuser",
    "sort",
    "sed",
    "grep",
    "awk",
    "flock",
    "timeout",
    "tail",
    "cut",
    "wc",
    "stty",
    "systemd-tmpfiles",
    "install",
    "id",
    "groupadd",
    "useradd",
    "usermod",
    "getent",
    "mktemp",
    "chown",
    "chmod",
    "cp",
    "mv",
  ];
  const missing = required.filter((name) => !commandExists(name));
  if (missing.length === 0) return;
  console.log(`Installing missing operating-system tools: ${missing.join(", ")}`);
  if (commandExists("dnf")) {
    run("dnf", [
      "install",
      "-y",
      "git",
      "curl",
      "openssl",
      "rsync",
      "shadow-utils",
      "util-linux",
      "coreutils",
      "grep",
      "sed",
      "gawk",
      "systemd",
      "glibc-common",
    ]);
    return;
  }
  if (commandExists("apt-get")) {
    run("apt-get", ["update"]);
    run("apt-get", [
      "install",
      "-y",
      "git",
      "curl",
      "openssl",
      "rsync",
      "passwd",
      "util-linux",
      "coreutils",
      "grep",
      "sed",
      "gawk",
      "systemd",
      "libc-bin",
    ]);
    return;
  }
  throw new Error(`Install these prerequisites manually: ${missing.join(", ")}`);
}

async function ensureSource(optionsValue, verifyExisting = true) {
  if (existsSync(optionsValue.source)) {
    if (!existsSync(path.join(optionsValue.source, ".git"))) {
      throw new Error(`Source directory exists but is not a Git checkout: ${optionsValue.source}`);
    }
    console.log(`Using existing source checkout: ${optionsValue.source}`);
    if (verifyExisting) verifyDefaultRelease(optionsValue);
    return;
  }
  await mkdir(path.dirname(optionsValue.source), { recursive: true });
  run("git", ["clone", "--branch", optionsValue.ref, optionsValue.repository, optionsValue.source]);
  verifyDefaultRelease(optionsValue);
  restoreSudoOwnership(optionsValue.source);
}

async function updateSource(optionsValue) {
  // An existing checkout is expected to point at the previous release. Verify
  // origin and the target commit only after fetching and checking out the new tag.
  await ensureSource(optionsValue, false);
  const status = capture("git", ["-C", optionsValue.source, "status", "--porcelain"]);
  if (status.trim()) {
    throw new Error(
      "Source checkout has uncommitted changes; refusing to update or overwrite them",
    );
  }
  run("git", ["-C", optionsValue.source, "fetch", "--tags", "origin", optionsValue.ref]);
  run("git", ["-C", optionsValue.source, "checkout", "--detach", "FETCH_HEAD"]);
  verifyDefaultRelease(optionsValue);
}

function verifyDefaultRelease(optionsValue) {
  if (optionsValue.ref !== defaults.ref || optionsValue.repository !== defaults.repository) return;
  const origin = capture("git", ["-C", optionsValue.source, "remote", "get-url", "origin"]).trim();
  if (origin !== defaults.repository) {
    throw new Error(`Source origin mismatch: expected ${defaults.repository}`);
  }
  const expectedCommit = capture("npm", ["view", `mytoken-gateway@${version}`, "gitHead"]).trim();
  if (!/^[a-f0-9]{40}$/u.test(expectedCommit)) {
    throw new Error(`npm release metadata has no valid gitHead for ${version}`);
  }
  const commit = capture("git", ["-C", optionsValue.source, "rev-parse", "HEAD"]).trim();
  if (commit !== expectedCommit) {
    throw new Error(`Release commit mismatch: expected ${expectedCommit}, found ${commit}`);
  }
}

function runInstaller(optionsValue) {
  const installer = path.join(optionsValue.source, "deploy", "install.sh");
  if (!existsSync(installer)) throw new Error(`Installer is missing: ${installer}`);
  run(installer, [], {
    ...process.env,
    MYTOKEN_SOURCE_DIR: optionsValue.source,
  });
}

function restoreSudoOwnership(source) {
  const user = process.env.SUDO_USER;
  if (!user || user === "root") return;
  const group = capture("id", ["-gn", user]).trim();
  run("chown", ["-R", `${user}:${group}`, source]);
}

function delegate(subcommand) {
  const ctl = "/usr/local/sbin/mytokenctl";
  if (!existsSync(ctl)) throw new Error("MyToken is not installed; run the install command first");
  run(ctl, [subcommand]);
}

function commandExists(name) {
  return spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", name]).status === 0;
}

function run(program, programArgs, env = process.env) {
  const result = spawnSync(program, programArgs, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} exited with status ${String(result.status)}`);
  }
}

function capture(program, programArgs) {
  const result = spawnSync(program, programArgs, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} exited with status ${String(result.status)}`);
  return result.stdout;
}

function printHandoff(source) {
  console.log(`cd ${source}
codex

Then ask Codex:
Read MASTER_PLAN.md, PROJECT_STATE.md, README.md, docs/THREAT_MODEL.md,
docs/CODEX_CONTRACT.md, docs/SERVER_HANDOFF.md, docs/OPERATIONS.md,
and the latest git log. Continue MyToken V0.1 from the current branch.
Preserve the service CODEX_HOME boundary. Run all checks before committing.
Do not push or deploy without explicit approval.`);
}

function usage() {
  console.log(`MyToken Gateway ${version}

Usage:
  mytoken-gateway install [--source DIR] [--ref GIT_REF] [--repo URL]
  mytoken-gateway update  [--source DIR] [--ref GIT_REF] [--repo URL]
  mytoken-gateway status|doctor|health|ready|backup|codex-status|codex-login
  mytoken-gateway provider-status|provider-reload
  mytoken-gateway handoff [--source DIR]
  mytoken-gateway version

Fresh server:
  sudo npx --yes mytoken-gateway@preview install

Defaults:
  source: ${defaults.source}
  ref:    ${defaults.ref}
  repo:   ${defaults.repository}`);
}
