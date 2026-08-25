import { execFileSync } from "node:child_process";
import path from "node:path";

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
    expect(output).toContain("sudo npx --yes mytoken-gateway@preview install");
    expect(output).toContain("v0.1.0-preview.1");
  });
});
