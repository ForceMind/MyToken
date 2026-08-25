import { MyTokenDatabase } from "../packages/database/src/index.js";

const path = process.env.MYTOKEN_DB_PATH;
if (!path) throw new Error("MYTOKEN_DB_PATH is required");
const database = new MyTokenDatabase(path);
try {
  database.migrate();
  console.log(`Database migrations applied: ${path}`);
} finally {
  database.close();
}
