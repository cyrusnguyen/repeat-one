import { defineConfig } from "@playwright/test";

const PORT = 3100;
// Shared by the test process (seeding) and the app server; isolated from the dev database.
process.env.DATABASE_URL = "file:../data/e2e.db";
process.env.ALLOWED_URL_PREFIXES = `http://localhost:${PORT}/demo/`;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx --no-install next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: process.env.DATABASE_URL, ALLOWED_URL_PREFIXES: process.env.ALLOWED_URL_PREFIXES, RUN_TIMEOUT_MS: "30000" },
  },
});
