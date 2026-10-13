import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// The E2E database is disposable: start each suite from an empty file.
export default function globalSetup() {
  rmSync("data/e2e.db", { force: true });
  execSync("npx --no-install prisma db push --skip-generate", { stdio: "inherit", env: process.env });
}
