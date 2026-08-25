import { DatabaseSync } from "node:sqlite";

import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { migrations } from "./migrations.js";

export class MyTokenDatabase {
  readonly sqlite: DatabaseSync;
  readonly db: NodeSQLiteDatabase;

  constructor(path: string) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.db = drizzle({ client: this.sqlite });
  }

  migrate(): void {
    this.sqlite.exec(`
CREATE TABLE IF NOT EXISTS __mytoken_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
);
`);
    const applied = this.sqlite.prepare("SELECT 1 FROM __mytoken_migrations WHERE id = ?");
    const record = this.sqlite.prepare(
      "INSERT INTO __mytoken_migrations (id, applied_at) VALUES (?, ?)",
    );
    for (const migration of migrations) {
      if (applied.get(migration.id)) continue;
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        this.sqlite.exec(migration.sql);
        record.run(migration.id, Date.now());
        this.sqlite.exec("COMMIT");
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
