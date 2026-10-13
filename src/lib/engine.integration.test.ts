/**
 * Engine integration tests: real Chromium, real portal fixture over HTTP, real SQLite.
 * The model is replaced by a SCRIPTED proposer here so recovery rules are tested deterministically;
 * live Opus recovery is covered by the E2E suite when ANTHROPIC_API_KEY is set.
 */
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { canonicalSteps, expectedUnpaid, renderPortal, setVariant, type Variant } from "./demo-portal";
import { parseCsv } from "./checks";
import { previewPlan } from "./preview";
import type { Proposer } from "./recovery";
import { ARTIFACT_ROOT, decideRepairManually, RunConflict, startRun, StaleDecision } from "./runner";
import type { Step } from "./schemas";
import type { StepLog } from "./store";

let server: Server;
let DEMO = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/demo/invoices")) {
      res.writeHead(200, { "content-type": "text/html" }).end(renderPortal((globalThis as { demoVariant?: Variant }).demoVariant ?? "classic"));
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "localhost", r));
  const { port } = server.address() as AddressInfo;
  process.env.ALLOWED_URL_PREFIXES = `http://localhost:${port}/demo/`;
  DEMO = `http://localhost:${port}/demo/invoices`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  setVariant("classic");
  delete process.env.MAX_RECOVERY_ATTEMPTS;
  delete process.env.ANTHROPIC_API_KEY;
});

const steps = (): Step[] => canonicalSteps(DEMO);

async function seed(policy: "auto_safe" | "ask" = "auto_safe", s: Step[] = steps()) {
  const wf = await db.workflow.create({
    data: {
      name: "Unpaid export", task: "Export unpaid invoices above a minimum amount to CSV.", startUrl: DEMO,
      allowedPrefixes: JSON.stringify([process.env.ALLOWED_URL_PREFIXES]),
      inputs: JSON.stringify([{ name: "minimumAmount", label: "Minimum amount", type: "number", default: "1000" }]),
      steps: JSON.stringify(s), status: "approved", recoveryPolicy: policy,
    },
  });
  return wf.id;
}

async function waitFor(runId: string, statuses: string[]) {
  for (let i = 0; i < 300; i++) {
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    if (statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Run ${runId} never reached ${statuses.join("/")}`);
}

const csvIds = (runId: string) => parseCsv(readFileSync(path.join(ARTIFACT_ROOT, runId, "export.csv"), "utf8")).rows.map((r) => r[0]);
const repairsOf = (runId: string) => db.repair.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });

// SCRIPTED stand-in for Opus: maps known redesigned selectors; records what it was shown.
const scripted = (map: Record<string, string | null>): Proposer => async (_s, ctx) => {
  const next = map[ctx.step.selector];
  if (next === undefined) throw new Error(`scripted proposer has no answer for ${ctx.step.selector}`);
  if (next === null) return { kind: "none", reason: "No equivalent control on the page." };
  return { kind: "repair", proposal: { selector: next, rationale: "scripted test proposal", confidence: "high" }, matched: { tag: "", type: null, id: "", role: null, label: "", visible: true, options: [] } };
};
const redesignMap = { "#min-amount": "#amount-floor", "#apply-filters": "#refresh-results" };

describe("execution engine (real browser)", () => {
  it("runs the saved plan, verifies the CSV and checkpoints every step", async () => {
    const runId = await startRun(await seed(), { minimumAmount: "1000" }, scripted({}));
    const run = await waitFor(runId, ["succeeded", "failed"]);
    expect(run.error).toBeNull();
    expect(run.status).toBe("succeeded");
    expect(csvIds(runId)).toEqual(expectedUnpaid(1000));
    expect(await db.checkpoint.count({ where: { runId } })).toBe(steps().length);
    expect(JSON.parse(run.definition).version).toBe(1);
    expect(existsSync(path.join(ARTIFACT_ROOT, runId, "step-9.png"))).toBe(true);
  });

  it("refuses a second concurrent run of the same workflow", async () => {
    const id = await seed();
    const first = await startRun(id, {}, scripted({}));
    await expect(startRun(id, {}, scripted({}))).rejects.toBeInstanceOf(RunConflict);
    await waitFor(first, ["succeeded", "failed"]);
  });
});

describe("recovery on a changed UI (scripted proposer)", () => {
  it("auto-applies a read-only repair, asks before a click repair, then re-verifies the original outcome", async () => {
    setVariant("redesigned");
    const runId = await startRun(await seed(), { minimumAmount: "3000" }, scripted(redesignMap));
    await waitFor(runId, ["needs_approval", "failed"]);
    const [fillRepair, clickRepair] = await repairsOf(runId);
    expect(fillRepair).toMatchObject({ action: "fill", failedSelector: "#min-amount", proposedSelector: "#amount-floor", decision: "auto_approved", outcome: "verified" });
    expect(clickRepair).toMatchObject({ action: "click", proposedSelector: "#refresh-results", decision: "pending" });
    expect(fillRepair.failureEvidence).toMatch(/step-4-attempt-1\.png/);

    await decideRepairManually(runId, clickRepair.id, "approved");
    const run = await waitFor(runId, ["succeeded", "failed"]);
    expect(run.error).toBeNull();
    expect(csvIds(runId)).toEqual(expectedUnpaid(3000));
    const log = JSON.parse(run.log) as StepLog[];
    expect(log[3]).toMatchObject({ attempts: 2, repairedSelector: "#amount-floor", status: "ok" });
    expect(log[3].failures[0].error).toMatch(/Element not found: #min-amount/);
    expect((await repairsOf(runId))[1]).toMatchObject({ decision: "approved", outcome: "verified" });
    // A decision on an already-decided repair is stale.
    await expect(decideRepairManually(runId, clickRepair.id, "approved")).rejects.toBeInstanceOf(StaleDecision);
    // The saved definition is unchanged: repairs apply to this run only.
    const wf = await db.workflow.findUniqueOrThrow({ where: { id: run.workflowId } });
    expect(wf.steps).toContain("#min-amount");
  });

  it("stops with a reviewer rejection and changes nothing", async () => {
    setVariant("redesigned");
    const runId = await startRun(await seed("ask"), {}, scripted(redesignMap));
    await waitFor(runId, ["needs_approval"]);
    const [pending] = await repairsOf(runId);
    expect(pending.decision).toBe("pending");
    await decideRepairManually(runId, pending.id, "rejected");
    const run = await waitFor(runId, ["failed"]);
    expect(run.error).toMatch(/Reviewer rejected/);
    expect(existsSync(path.join(ARTIFACT_ROOT, runId, "export.csv"))).toBe(false);
  });

  it("engine rejects destructive and stale proposals even if the proposer offers them", async () => {
    setVariant("redesigned");
    const destructive = await startRun(await seed(), {}, scripted({ "#min-amount": "#amount-floor", "#apply-filters": "#delete-selected" }));
    expect((await waitFor(destructive, ["failed"])).error).toMatch(/rejected by engine: .*destructive/);
    const stale = await startRun(await seed(), {}, scripted({ "#min-amount": "#min-amount" }));
    expect((await waitFor(stale, ["failed"])).error).toMatch(/stale repair/);
    expect((await repairsOf(stale))[0].decision).toBe("invalid");
  });

  it("stops when the recovery budget is exhausted", async () => {
    setVariant("redesigned");
    process.env.MAX_RECOVERY_ATTEMPTS = "1";
    const runId = await startRun(await seed(), {}, scripted(redesignMap));
    const run = await waitFor(runId, ["failed", "needs_approval"]);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Recovery budget exhausted \(1 per run\)/);
    expect(await db.repair.count({ where: { runId } })).toBe(1);
  });

  it("ends truthfully when the target is unavailable (export removed)", async () => {
    setVariant("export_removed");
    const runId = await startRun(await seed(), {}, scripted({ "#export-csv": null }));
    const run = await waitFor(runId, ["failed"]);
    expect(run.error).toMatch(/Recovery stopped safely: No equivalent control/);
    expect((await repairsOf(runId))[0]).toMatchObject({ decision: "no_safe_repair", outcome: "not_applied" });
    expect(existsSync(path.join(ARTIFACT_ROOT, runId, "final.png"))).toBe(true);
  });

  it("an engine-invalid target for the action class is rejected (span is not a download button)", async () => {
    setVariant("export_removed");
    const runId = await startRun(await seed(), {}, scripted({ "#export-csv": "#export-disabled" }));
    expect((await waitFor(runId, ["failed"])).error).toMatch(/download needs a button or link/);
  });

  it("without a model key, recovery fails with the real reason instead of guessing", async () => {
    setVariant("redesigned");
    const runId = await startRun(await seed(), {}); // default proposer = Opus
    const run = await waitFor(runId, ["failed"]);
    expect(run.error).toMatch(/Recovery could not run: ANTHROPIC_API_KEY is not set/);
    expect((await repairsOf(runId))[0].decision).toBe("error");
  });
});

describe("plan preview (read-only, before approval)", () => {
  it("locates targets on the live page without running anything", async () => {
    const items = await previewPlan(DEMO, canonicalSteps(DEMO), [{ name: "minimumAmount", label: "Min", type: "number", default: "1000" }], [process.env.ALLOWED_URL_PREFIXES!]);
    const byStep = Object.fromEntries(items.map((i) => [i.step, i]));
    expect(byStep[1]).toMatchObject({ action: "navigate", status: "loaded" });
    expect(byStep[4]).toMatchObject({ action: "fill", status: "found" });
    expect(byStep[4].image).toMatch(/^data:image\/jpeg;base64,/);
    expect(byStep[9]).toMatchObject({ action: "screenshot", status: "not_checked" });
    expect(items.filter((i) => i.status === "error")).toEqual([]);
  });

  it("reports targets that a changed UI no longer has", async () => {
    setVariant("redesigned");
    const items = await previewPlan(DEMO, canonicalSteps(DEMO), [], [process.env.ALLOWED_URL_PREFIXES!]);
    expect(items.find((i) => i.target.startsWith("#min-amount"))?.status).toBe("missing");
    expect(items.find((i) => i.target === "#apply-filters")?.status).toBe("missing");
    expect(items.find((i) => i.target === "#export-csv")?.status).toBe("found");
  });
});
