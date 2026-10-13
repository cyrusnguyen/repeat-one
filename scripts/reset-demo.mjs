// Deletes local demo data (SQLite DB and run artifacts) and recreates an empty database.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("data/repeatone.db", { force: true });
rmSync("data/repeatone.db-journal", { force: true });
rmSync("data/artifacts", { recursive: true, force: true });
execSync("npx --no-install prisma db push --skip-generate", { stdio: "inherit" });
console.log("Demo data reset. Restart the app to also reset the portal UI variant to Classic.");
