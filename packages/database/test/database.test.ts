import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createMyTokenKey } from "@mytoken/key-auth";

import { ApiKeyRepository } from "../src/api-key-repository.js";
import { MyTokenDatabase } from "../src/database.js";

const databases: MyTokenDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("MyTokenDatabase", () => {
  it("applies migrations idempotently and persists only the key digest", async () => {
    const database = new MyTokenDatabase(":memory:");
    databases.push(database);
    database.migrate();
    database.migrate();

    const pepper = randomBytes(32);
    const key = createMyTokenKey(pepper, {
      mode: "live",
      name: "OpenClaw",
      allowedModels: ["gpt-fixture"],
      allowClientTools: true,
    });
    const repository = new ApiKeyRepository(database);
    repository.create(key.record);

    const loaded = await repository.getById(key.record.id);
    expect(loaded).toEqual(key.record);
    const serializedRows = JSON.stringify(database.sqlite.prepare("SELECT * FROM api_keys").all());
    expect(serializedRows).not.toContain(key.plaintext);
  });

  it("revokes a key immediately", async () => {
    const database = new MyTokenDatabase(":memory:");
    databases.push(database);
    database.migrate();
    const key = createMyTokenKey(randomBytes(32), { mode: "test", name: "Temporary" });
    const repository = new ApiKeyRepository(database);
    repository.create(key.record);
    expect(repository.revoke(key.record.id, 1234)).toBe(true);
    expect((await repository.getById(key.record.id))?.revokedAt).toBe(1234);
  });
});
