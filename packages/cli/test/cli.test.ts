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

  it("allows an existing previous-release checkout before verifying the fetched target", () => {
    const source = readFileSync(path.resolve("packages/cli/bin/mytoken-gateway.mjs"), "utf8");
    const updateStart = source.indexOf("async function updateSource");
    const updateEnd = source.indexOf("function verifyDefaultRelease", updateStart);
    const updateFunction = source.slice(updateStart, updateEnd);
    expect(updateFunction).toContain("await ensureSource(optionsValue, false)");
    expect(updateFunction.indexOf('checkout", "--detach", "FETCH_HEAD')).toBeLessThan(
      updateFunction.indexOf("verifyDefaultRelease(optionsValue)"),
    );
  });
});
