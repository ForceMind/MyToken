import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("deployment shell scripts", () => {
  for (const script of [
    "deploy/install.sh",
    "deploy/scripts/generate-secrets.sh",
    "deploy/bin/mytokenctl",
    "deploy/bin/mytoken-update-runner",
    "deploy/bin/mytoken-codex-import-runner",
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

  it("uses GitHub tags for managed updates without invoking npm", () => {
    const source = readFileSync(path.resolve("deploy/bin/mytoken-update-runner"), "utf8");
    expect(source).toContain('git -C "$source_dir" fetch --force --tags origin');
    expect(source).toContain('"$source_dir/deploy/install.sh"');
    expect(source).toContain("select-release-tag.mjs");
    expect(source).not.toContain("npm view");
    expect(source).not.toContain("npx --yes");
    const selected = execFileSync(
      process.execPath,
      [path.resolve("deploy/scripts/select-release-tag.mjs")],
      { encoding: "utf8", input: "v0.1.0-preview.9\nv0.1.0\nv0.2.0-preview.1\ninvalid\n" },
    );
    expect(selected).toBe("v0.2.0-preview.1");
    const stable = execFileSync(
      process.execPath,
      [path.resolve("deploy/scripts/select-release-tag.mjs")],
      { encoding: "utf8", input: "v0.1.0-preview.99\nv0.1.0\n" },
    );
    expect(stable).toBe("v0.1.0");
  });

  it("migrates providers into API-managed protected state", () => {
    const installer = readFileSync(path.resolve("deploy/install.sh"), "utf8");
    expect(installer).toContain("MYTOKEN_PROVIDER_SECRETS_DIR");
    expect(installer).toContain("migrate-provider-config.mjs");
    expect(() =>
      execFileSync(process.execPath, [
        "--check",
        path.resolve("deploy/scripts/migrate-provider-config.mjs"),
      ]),
    ).not.toThrow();

    const directory = mkdtempSync(path.join(tmpdir(), "mytoken-provider-migration-"));
    try {
      const oldSecret = path.join(directory, "old-deepseek-key");
      const legacy = path.join(directory, "legacy.json");
      const destination = path.join(directory, "managed", "providers.json");
      const secrets = path.join(directory, "managed", "secrets");
      writeFileSync(oldSecret, "deepseek-secret");
      writeFileSync(
        legacy,
        JSON.stringify({
          providers: [
            {
              id: "deepseek",
              name: "DeepSeek",
              protocol: "openai-responses",
              baseUrl: "https://api.deepseek.com",
              apiKeyFile: oldSecret,
              enabled: true,
            },
          ],
        }),
      );
      execFileSync(process.execPath, [
        path.resolve("deploy/scripts/migrate-provider-config.mjs"),
        legacy,
        path.resolve("deploy/providers.example.json"),
        destination,
        secrets,
      ]);
      expect(JSON.parse(readFileSync(destination, "utf8"))).toMatchObject({
        providers: [
          {
            id: "deepseek",
            protocol: "openai-chat",
            apiKeyFile: path.join(secrets, "deepseek"),
          },
        ],
      });
      expect(readFileSync(path.join(secrets, "deepseek"), "utf8")).toBe("deepseek-secret");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("installs a guarded root-only Codex credential importer", () => {
    const installer = readFileSync(path.resolve("deploy/install.sh"), "utf8");
    const runner = readFileSync(path.resolve("deploy/bin/mytoken-codex-import-runner"), "utf8");
    const unit = readFileSync(path.resolve("deploy/systemd/mytoken-codex-import.service"), "utf8");
    expect(installer).toContain("mytoken-codex-import.path");
    expect(installer).toContain("mytoken-codex-import-runner");
    expect(runner).toContain('source_auth="$source_codex_home/auth.json"');
    expect(runner).toContain("copy-codex-auth.mjs");
    expect(runner).toContain("runuser -u mytoken-codex");
    expect(runner).not.toContain('cat "$source_auth"');
    expect(unit).toContain("ProtectHome=read-only");
    expect(unit).toContain("ReadWritePaths=/var/lib/mytoken /run/mytoken");

    const directory = mkdtempSync(path.join(tmpdir(), "mytoken-codex-auth-copy-"));
    try {
      const source = path.join(directory, "auth.json");
      const destination = path.join(directory, "copied.json");
      writeFileSync(source, '{"auth":"opaque"}', { mode: 0o600 });
      execFileSync(process.execPath, [
        path.resolve("deploy/scripts/copy-codex-auth.mjs"),
        source,
        destination,
        String(process.getuid?.() ?? 0),
        "1048576",
      ]);
      expect(readFileSync(destination, "utf8")).toBe('{"auth":"opaque"}');

      const symlink = path.join(directory, "auth-link.json");
      symlinkSync(source, symlink);
      expect(() =>
        execFileSync(
          process.execPath,
          [
            path.resolve("deploy/scripts/copy-codex-auth.mjs"),
            symlink,
            path.join(directory, "should-not-exist.json"),
            String(process.getuid?.() ?? 0),
            "1048576",
          ],
          { stdio: "pipe" },
        ),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
