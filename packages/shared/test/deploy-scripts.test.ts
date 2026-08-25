import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("deployment shell scripts", () => {
  for (const script of [
    "deploy/install.sh",
    "deploy/scripts/generate-secrets.sh",
    "deploy/bin/mytokenctl",
  ]) {
    it(`${script} has valid POSIX shell syntax`, () => {
      expect(() =>
        execFileSync("sh", ["-n", path.resolve(script)], { stdio: "pipe" }),
      ).not.toThrow();
    });
  }
});
