import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/drizzle",
  dbCredentials: {
    url: process.env.MYTOKEN_DB_PATH ?? "./var/mytoken.sqlite",
  },
});
