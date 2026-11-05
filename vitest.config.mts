import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // Tests must never open the developer's real database: default every worker to a throwaway dir.
    env: { DATA_DIR: ".test-data" },
  },
});
