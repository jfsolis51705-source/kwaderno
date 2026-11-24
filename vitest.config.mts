import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // `server-only` throws outside the Next.js bundler; tests run server code directly.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/helpers/global-setup.ts"],
    setupFiles: ["./tests/helpers/setup.ts"],
    // Tests share one Postgres database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
