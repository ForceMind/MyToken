import type { MyTokenKeyRecord } from "@mytoken/key-auth";

import type { ApiKeyStore } from "./app.js";

export class MemoryApiKeyStore implements ApiKeyStore {
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
}
