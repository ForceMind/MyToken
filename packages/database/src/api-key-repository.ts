import { eq } from "drizzle-orm";

import type { MyTokenKeyRecord, UpdateMyTokenKeyPolicy } from "@mytoken/key-auth";
import { MyTokenError } from "@mytoken/shared";

import type { MyTokenDatabase } from "./database.js";
import { apiKeys } from "./schema.js";

export class ApiKeyRepository {
  constructor(readonly database: MyTokenDatabase) {}

  create(record: MyTokenKeyRecord): void {
    this.database.db
      .insert(apiKeys)
      .values({
        id: record.id,
        mode: record.mode,
        name: record.name,
        prefix: record.prefix,
        secretDigest: record.secretDigest,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
        lastUsedAt: record.lastUsedAt,
        allowedModelsJson: JSON.stringify(record.allowedModels),
        allowClientTools: record.allowClientTools ? 1 : 0,
        rpmLimit: record.rpmLimit,
        dailyRequestLimit: record.dailyRequestLimit,
        maxConcurrency: record.maxConcurrency,
        ipAllowlistJson: JSON.stringify(record.ipAllowlist),
        requestBudget: record.requestBudget,
        tokenBudget: record.tokenBudget,
      })
      .run();
  }

  getById(keyId: string): Promise<MyTokenKeyRecord | undefined> {
    const row = this.database.db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get();
    if (!row) return Promise.resolve(undefined);
    if (row.mode !== "live" && row.mode !== "test") {
      throw new MyTokenError("invalid_database_key_mode", "Invalid API Key mode in database");
    }
    const allowedModels = parseStringArray(row.allowedModelsJson);
    return Promise.resolve({
      id: row.id,
      mode: row.mode,
      name: row.name,
      prefix: row.prefix,
      secretDigest: row.secretDigest,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
      allowedModels,
      allowClientTools: row.allowClientTools === 1,
      rpmLimit: row.rpmLimit,
      dailyRequestLimit: row.dailyRequestLimit,
      maxConcurrency: row.maxConcurrency,
      ipAllowlist: parseStringArray(row.ipAllowlistJson),
      requestBudget: row.requestBudget,
      tokenBudget: row.tokenBudget,
    });
  }

  touchLastUsed(keyId: string, now = Date.now()): void {
    this.database.db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, keyId)).run();
  }

  async updatePolicy(keyId: string, patch: UpdateMyTokenKeyPolicy): Promise<boolean> {
    const current = await this.getById(keyId);
    if (!current) return false;
    const next = { ...current, ...patch };
    const result = this.database.db
      .update(apiKeys)
      .set({
        expiresAt: next.expiresAt,
        allowedModelsJson: JSON.stringify(next.allowedModels),
        allowClientTools: next.allowClientTools ? 1 : 0,
        rpmLimit: next.rpmLimit,
        dailyRequestLimit: next.dailyRequestLimit,
        maxConcurrency: next.maxConcurrency,
        ipAllowlistJson: JSON.stringify(next.ipAllowlist),
        requestBudget: next.requestBudget,
        tokenBudget: next.tokenBudget,
      })
      .where(eq(apiKeys.id, keyId))
      .run();
    return result.changes > 0;
  }

  revoke(keyId: string, now = Date.now()): boolean {
    const result = this.database.db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(eq(apiKeys.id, keyId))
      .run();
    return result.changes > 0;
  }

  list(): Promise<readonly MyTokenKeyRecord[]> {
    const rows = this.database.db.select().from(apiKeys).all();
    return Promise.all(rows.map(async (row) => this.getById(row.id))).then((records) =>
      records.filter((record): record is MyTokenKeyRecord => record !== undefined),
    );
  }
}

function parseStringArray(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new MyTokenError("invalid_database_json", "Invalid model policy JSON", error);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new MyTokenError("invalid_database_json", "Invalid model policy JSON");
  }
  return parsed;
}
