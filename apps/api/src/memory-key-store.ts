import type { MyTokenKeyRecord } from "@mytoken/key-auth";

import type { ApiKeyStore } from "./app.js";
import type { ApiKeyManagementStore } from "./admin-routes.js";

export class MemoryApiKeyStore implements ApiKeyStore, ApiKeyManagementStore {
  readonly #records = new Map<string, MyTokenKeyRecord>();

  constructor(records: readonly MyTokenKeyRecord[] = []) {
    for (const record of records) this.#records.set(record.id, record);
  }

  getById(keyId: string): Promise<MyTokenKeyRecord | undefined> {
    return Promise.resolve(this.#records.get(keyId));
  }

  set(record: MyTokenKeyRecord): void {
    this.#records.set(record.id, record);
  }

  create(record: MyTokenKeyRecord): void {
    this.set(record);
  }

  revoke(keyId: string, now = Date.now()): boolean {
    const record = this.#records.get(keyId);
    if (!record) return false;
    this.#records.set(keyId, { ...record, revokedAt: record.revokedAt ?? now });
    return true;
  }

  list(): Promise<readonly MyTokenKeyRecord[]> {
    return Promise.resolve([...this.#records.values()]);
  }
}
