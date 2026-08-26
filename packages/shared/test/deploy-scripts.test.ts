import { execFileSync } from "node:child_process";
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
    const source = execFileSync("sed", ["-n", "150,210p", path.resolve("deploy/install.sh")], {
      encoding: "utf8",
    });
    expect(source).toContain("set_env_value MYTOKEN_VERSION");
    expect(source).toContain("set_env_value MYTOKEN_WEB_ROOT");
  });
});
