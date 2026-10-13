import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Disposable database for the engine integration tests.
export default function setup() {
  rmSync("data/vitest.db", { force: true });
  execSync("npx --no-install prisma db push --skip-generate", { stdio: "ignore", env: { ...process.env, DATABASE_URL: "file:../data/vitest.db" } });
}
