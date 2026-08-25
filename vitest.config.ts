import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@mytoken/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@mytoken/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@mytoken/key-auth": fileURLToPath(
        new URL("./packages/key-auth/src/index.ts", import.meta.url),
      ),
      "@mytoken/openai-compat": fileURLToPath(
        new URL("./packages/openai-compat/src/index.ts", import.meta.url),
      ),
      "@mytoken/admin-auth": fileURLToPath(
        new URL("./packages/admin-auth/src/index.ts", import.meta.url),
      ),
      "@mytoken/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
