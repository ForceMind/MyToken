import { MyTokenDatabase } from "../packages/database/src/index.js";

const path = process.env.MYTOKEN_DB_PATH ?? ":memory:";
const database = new MyTokenDatabase(path);
try {
  database.migrate();
  const result = database.sqlite.prepare("PRAGMA integrity_check").get() as {
    integrity_check?: string;
  };
  if (result.integrity_check !== "ok") {
    throw new Error("SQLite integrity check failed");
  }
  const migrations = database.sqlite
    .prepare("SELECT id, applied_at AS appliedAt FROM __mytoken_migrations ORDER BY id")
    .all();
  console.log(JSON.stringify({ database: path, integrity: "ok", migrations }, null, 2));
} finally {
  database.close();
}
