import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { MyTokenError } from "@mytoken/shared";

export type KeyMode = "live" | "test";

export interface MyTokenKeyRecord {
  id: string;
  mode: KeyMode;
  name: string;
  prefix: string;
  secretDigest: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  allowedModels: readonly string[];
  allowClientTools: boolean;
  rpmLimit: number;
  dailyRequestLimit: number;
  maxConcurrency: number;
}

export interface CreateMyTokenKeyOptions {
  mode: KeyMode;
  name: string;
  now?: number;
  expiresAt?: number | null;
  allowedModels?: readonly string[];
  allowClientTools?: boolean;
  rpmLimit?: number;
  dailyRequestLimit?: number;
  maxConcurrency?: number;
}

export interface CreatedMyTokenKey {
  plaintext: string;
  record: MyTokenKeyRecord;
}

export interface ParsedMyTokenKey {
  mode: KeyMode;
  keyId: string;
  secret: string;
}

const keyPattern = /^myt_(live|test)_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/u;

export function createMyTokenKey(
  pepper: Uint8Array,
  options: CreateMyTokenKeyOptions,
): CreatedMyTokenKey {
  assertPepper(pepper);
  const now = options.now ?? Date.now();
  const keyId = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `myt_${options.mode}_${keyId}_${secret}`;
  const prefix = `${plaintext.slice(0, 20)}…`;

  return {
    plaintext,
    record: {
      id: keyId,
      mode: options.mode,
      name: options.name,
      prefix,
      secretDigest: digestSecret(pepper, keyId, secret),
      createdAt: now,
      expiresAt: options.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
      allowedModels: options.allowedModels ?? [],
      allowClientTools: options.allowClientTools ?? false,
      rpmLimit: options.rpmLimit ?? 10,
      dailyRequestLimit: options.dailyRequestLimit ?? 100,
      maxConcurrency: options.maxConcurrency ?? 1,
    },
  };
}

export function parseMyTokenKey(value: string): ParsedMyTokenKey | null {
  const match = keyPattern.exec(value);
  if (!match) return null;
  const [, mode, keyId, secret] = match;
  if (!mode || !keyId || !secret) return null;
  return { mode: mode as KeyMode, keyId, secret };
}

export function verifyMyTokenKey(
  pepper: Uint8Array,
  plaintext: string,
  record: MyTokenKeyRecord,
  now = Date.now(),
): boolean {
  assertPepper(pepper);
  const parsed = parseMyTokenKey(plaintext);
  if (!parsed || parsed.keyId !== record.id || parsed.mode !== record.mode) return false;
  if (record.revokedAt !== null) return false;
  if (record.expiresAt !== null && record.expiresAt <= now) return false;

  const expected = Buffer.from(record.secretDigest, "base64url");
  const actual = Buffer.from(digestSecret(pepper, parsed.keyId, parsed.secret), "base64url");
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

export function revokeMyTokenKey(record: MyTokenKeyRecord, now = Date.now()): MyTokenKeyRecord {
  return { ...record, revokedAt: record.revokedAt ?? now };
}

function digestSecret(pepper: Uint8Array, keyId: string, secret: string): string {
  return createHmac("sha256", pepper).update(`${keyId}.${secret}`).digest("base64url");
}

function assertPepper(pepper: Uint8Array): void {
  if (pepper.byteLength < 32) {
    throw new MyTokenError("weak_key_pepper", "MyToken key pepper must be at least 32 bytes");
  }
}
