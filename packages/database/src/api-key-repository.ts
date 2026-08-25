import { eq } from "drizzle-orm";

import type { MyTokenKeyRecord } from "@mytoken/key-auth";
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
      })
      .run();
  }

  getById(keyId: string): Promise<MyTokenKeyRecord | undefined> {
    const row = this.database.db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get();
    if (!row) return Promise.resolve(undefined);
    const allowedModels = parseStringArray(row.allowedModelsJson);
    return Promise.resolve({
      id: row.id,
      mode: row.mode === "test" ? "test" : "live",
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
    });
  }

  revoke(keyId: string, now = Date.now()): boolean {
    const result = this.database.db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(eq(apiKeys.id, keyId))
      .run();
    return result.changes > 0;
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
