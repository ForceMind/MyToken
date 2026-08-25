import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createMyTokenKey,
  parseMyTokenKey,
  revokeMyTokenKey,
  verifyMyTokenKey,
} from "../src/index.js";

describe("MyToken key authentication", () => {
  it("creates a one-time plaintext key and verifies only its digest", () => {
    const pepper = randomBytes(32);
    const created = createMyTokenKey(pepper, {
      mode: "live",
      name: "OpenClaw",
      allowedModels: ["gpt-test"],
      allowClientTools: true,
      now: 100,
      expiresAt: 1_000,
    });

    expect(created.plaintext).toMatch(/^myt_live_/u);
    expect(created.record.secretDigest).not.toContain(created.plaintext);
    expect(parseMyTokenKey(created.plaintext)?.keyId).toBe(created.record.id);
    expect(verifyMyTokenKey(pepper, created.plaintext, created.record, 500)).toBe(true);
    expect(verifyMyTokenKey(randomBytes(32), created.plaintext, created.record, 500)).toBe(false);
  });

  it("parses keys unambiguously when the secret contains separators", () => {
    const value = `myt_live_${"a".repeat(32)}_${"_".repeat(43)}`;
    expect(parseMyTokenKey(value)).toEqual({
      mode: "live",
      keyId: "a".repeat(32),
      secret: "_".repeat(43),
    });
  });

  it("rejects expired and revoked keys", () => {
    const pepper = randomBytes(32);
    const created = createMyTokenKey(pepper, {
      mode: "test",
      name: "Temporary",
      now: 100,
      expiresAt: 200,
    });

    expect(verifyMyTokenKey(pepper, created.plaintext, created.record, 200)).toBe(false);
    expect(
      verifyMyTokenKey(pepper, created.plaintext, revokeMyTokenKey(created.record, 150), 151),
    ).toBe(false);
  });

  it("requires a high-entropy server pepper", () => {
    expect(() => createMyTokenKey(Buffer.alloc(16), { mode: "live", name: "Weak" })).toThrowError(
      /at least 32 bytes/u,
    );
  });
});
