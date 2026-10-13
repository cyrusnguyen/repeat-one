import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/vitest-setup.ts"],
    env: { DATABASE_URL: "file:../data/vitest.db" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
