import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("published installer CLI", () => {
  it("prints help without changing system state", () => {
    const output = execFileSync(
      process.execPath,
      [path.resolve("packages/cli/bin/mytoken-gateway.mjs"), "--help"],
      {
        encoding: "utf8",
      },
    );
    const packageJson = JSON.parse(
      readFileSync(path.resolve("packages/cli/package.json"), "utf8"),
    ) as { version: string };
    expect(output).toContain("sudo npx --yes mytoken-gateway@preview install");
    expect(output).toContain(`v${packageJson.version}`);
  });
});
