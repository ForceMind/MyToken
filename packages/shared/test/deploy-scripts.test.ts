import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("deployment shell scripts", () => {
  for (const script of [
    "deploy/install.sh",
    "deploy/scripts/generate-secrets.sh",
    "deploy/bin/mytokenctl",
    "deploy/bin/mytoken-update-runner",
  ]) {
    it(`${script} has valid POSIX shell syntax`, () => {
      expect(() =>
        execFileSync("sh", ["-n", path.resolve(script)], { stdio: "pipe" }),
      ).not.toThrow();
    });
  }

  it("migrates release-derived environment values during upgrades", () => {
    const source = readFileSync(path.resolve("deploy/install.sh"), "utf8");
    expect(source).toContain("set_env_value MYTOKEN_VERSION");
    expect(source).toContain("set_env_value MYTOKEN_WEB_ROOT");
    expect(source).toContain('"$source_dir/packages/cli/package.json"');
    expect(source).toContain("environment_backup_file");
    expect(source).toContain("transaction_active");
    expect(source).toContain("http://127.0.0.1:8080/versionz");
    expect(source).toContain("http://127.0.0.1:8080/version.json");
    expect(source).toContain("--exclude dist");
    expect(source).toContain('build_group="$(id -gn "$build_user")"');
  });

  it("reports the deployed CLI release rather than the monorepo version", () => {
    const source = readFileSync(path.resolve("deploy/bin/mytokenctl"), "utf8");
    expect(source).toContain("$install_dir/packages/cli/package.json");
    expect(source).not.toContain('"$install_dir/package.json"');
  });
});
