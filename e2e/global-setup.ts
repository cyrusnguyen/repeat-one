import { execSync, spawn, spawnSync } from "node:child_process";
import { openSync, rmSync } from "node:fs";
import path from "node:path";

const PORT = 3100;

// The E2E database is disposable, and the app server is managed here rather than by Playwright's
// webServer, whose shutdown hangs for minutes on Windows. Returning a function makes it the teardown.
export default async function globalSetup() {
  // A server already on the port would be tested instead of ours, against the wrong database.
  if (await fetch(`http://localhost:${PORT}/api/config`).then(() => true, () => false)) {
    throw new Error(`Port ${PORT} is already in use. Stop that server before running E2E.`);
  }
  rmSync("data/e2e.db", { force: true });
  execSync("npx --no-install prisma db push --skip-generate", { stdio: "ignore", env: process.env });

  // Live model calls are opt-in (E2E_LIVE=1). Otherwise the app gets an empty key, so default runs are free and deterministic.
  const env = { ...process.env, RUN_TIMEOUT_MS: "60000", ...(process.env.E2E_LIVE === "1" ? {} : { ANTHROPIC_API_KEY: "" }) };
  const log = openSync("data/e2e-server.log", "w");
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: ["ignore", log, log] });
  const deadline = Date.now() + 60_000;
  while (true) {
    if (server.exitCode !== null) throw new Error(`App server exited early (code ${server.exitCode}). Is port ${PORT} free? Did you run pnpm build?`);
    const up = await fetch(`http://localhost:${PORT}/api/config`).then((r) => r.ok, () => false);
    if (up) break;
    if (Date.now() > deadline) throw new Error("App server did not start within 60s.");
    await new Promise((r) => setTimeout(r, 250));
  }

  return () => {
    if (process.platform === "win32") {
      const taskkill = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "taskkill.exe");
      const r = spawnSync(taskkill, ["/pid", String(server.pid), "/T", "/F"], { encoding: "utf8" });
      if (r.status !== 0) console.warn(`Could not stop app server ${server.pid}: ${r.error?.message ?? r.stderr}`);
    } else server.kill("SIGTERM");
  };
}
