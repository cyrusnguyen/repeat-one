import { mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import * as browser from "./browser";
import { newUsage } from "./ai";
import { evaluateCheck, type Table } from "./checks";
import { checkProposal, decideRepair, proposeRepairWithOpus, RECOVERABLE, type LocatorStep, type Proposer, type RepairContext } from "./recovery";
import { fillTemplate, resolveInputs, stepTarget, type Step } from "./schemas";
import { globalPrefixes, isUrlAllowed, redact } from "./safety";
import { assertTransition, IllegalTransition, isActive, type RunStatus } from "./state";
import { parseWorkflow, type CheckLog, type Definition, type StepLog } from "./store";

export const ARTIFACT_ROOT = path.resolve(process.cwd(), "data", "artifacts");

type Decision = "approved" | "rejected";
type Active = { workflowId: string; controller: AbortController; pending?: { repairId: string; resolve: (d: Decision) => void } };
// Survives Next dev hot reloads; a single local process is the documented deployment.
const g = globalThis as unknown as { runs?: Map<string, Active>; starting?: Set<string> };
const active = (g.runs ??= new Map());
const starting = (g.starting ??= new Set());

export class RunConflict extends Error {
  constructor(public runId: string) { super("This workflow already has a run in progress."); }
}
export class StaleDecision extends Error {}
class StepFailure extends Error {}

const num = (v: string | undefined, d: number) => Number(v || d);
const limits = () => ({
  timeoutMs: num(process.env.RUN_TIMEOUT_MS, 180_000),
  maxSteps: num(process.env.MAX_RUN_STEPS, 30),
  maxRecoveries: num(process.env.MAX_RECOVERY_ATTEMPTS, 3),
  approvalTimeoutMs: num(process.env.APPROVAL_TIMEOUT_MS, 300_000),
});

/** Starts a run of the saved, approved definition. At most one active run per workflow. */
export async function startRun(workflowId: string, rawInputs: Record<string, unknown>, proposer: Proposer = proposeRepairWithOpus): Promise<string> {
  for (const [runId, a] of active) if (a.workflowId === workflowId) throw new RunConflict(runId);
  if (starting.has(workflowId)) throw new RunConflict("");
  starting.add(workflowId);
  try {
    const row = await db.workflow.findUnique({ where: { id: workflowId } });
    if (!row) throw new Error("Workflow not found.");
    if (row.status !== "approved") throw new Error("This plan has not been approved. Review and approve it before running.");
    const wf = parseWorkflow(row);
    const values = resolveInputs(wf.inputs, rawInputs);
    const definition: Definition = { version: wf.version, steps: wf.steps, inputs: wf.inputs, allowedPrefixes: wf.allowedPrefixes, recoveryPolicy: wf.recoveryPolicy };
    const run = await db.run.create({
      data: { workflowId, workflowVersion: wf.version, definition: JSON.stringify(definition), inputs: JSON.stringify(values), status: "queued" },
    });
    const controller = new AbortController();
    active.set(run.id, { workflowId, controller });
    void execute(run.id, wf.task, definition, values, controller.signal, proposer).finally(() => active.delete(run.id));
    return run.id;
  } finally {
    starting.delete(workflowId);
  }
}

export function cancelRun(runId: string): boolean {
  const a = active.get(runId);
  a?.controller.abort("cancelled");
  return !!a;
}

/** Human decision on a pending repair. Only the repair the run is currently waiting on can be decided. */
export async function decideRepairManually(runId: string, repairId: string, decision: Decision) {
  const repair = await db.repair.findUnique({ where: { id: repairId } });
  if (!repair || repair.runId !== runId) throw new StaleDecision("Repair not found for this run.");
  const waiting = active.get(runId)?.pending;
  if (repair.decision !== "pending" || waiting?.repairId !== repairId) throw new StaleDecision(`This repair is no longer awaiting a decision (it is ${repair.decision}).`);
  waiting.resolve(decision);
}

/** An active row with no live executor was orphaned (restart/crash); record that truthfully. */
export async function reconcileRun<T extends { id: string; status: string }>(run: T): Promise<T> {
  if (!isActive(run.status) || active.has(run.id)) return run;
  const error = "Interrupted: the worker running this run stopped (server restart or crash). Only steps up to the last checkpoint were verified.";
  await db.run.updateMany({ where: { id: run.id, status: run.status }, data: { status: "failed", error, finishedAt: new Date() } });
  await db.repair.updateMany({ where: { runId: run.id, decision: "pending" }, data: { decision: "expired", decisionReason: "Run was interrupted." } });
  return { ...run, status: "failed", error };
}

async function execute(runId: string, task: string, def: Definition, values: Record<string, string>, signal: AbortSignal, proposer: Proposer) {
  const { timeoutMs, maxSteps, maxRecoveries, approvalTimeoutMs } = limits();
  const dir = path.join(ARTIFACT_ROOT, runId);
  const log: StepLog[] = def.steps.map((s, index) => ({ index, action: s.action, target: stepTarget(s), description: s.description, status: "pending", attempts: 0, failures: [] }));
  const checks: CheckLog[] = [];
  const data: { table?: Table; csv?: Table } = {};
  const usage = newUsage();
  const t = (text: string) => fillTemplate(text, values);
  let status: RunStatus = "queued";
  let csvFile: string | null = null;
  let session: browser.Session | undefined;
  let recoveries = 0;
  let lastEvidence: string | null = null;

  const save = (extra: Record<string, unknown> = {}) =>
    db.run.update({ where: { id: runId }, data: { log: JSON.stringify(log), checks: JSON.stringify(checks), usage: JSON.stringify(usage), csvFile, ...extra } });
  // Compare-and-set on the persisted status: an illegal or concurrent transition fails loudly.
  const move = async (to: RunStatus, extra: Record<string, unknown> = {}) => {
    assertTransition(status, to);
    const { count } = await db.run.updateMany({ where: { id: runId, status }, data: { status: to, ...extra } });
    if (count !== 1) throw new IllegalTransition(status, to);
    status = to;
  };
  const snap = async (name: string) => {
    if (!session) return undefined;
    return browser.screenshot(session, path.join(dir, name)).then(() => { lastEvidence = name; return name; }, () => undefined);
  };

  // Hard deadline; paused only while waiting for a human decision.
  let remaining = timeoutMs;
  let timerStarted = Date.now();
  let timer = setTimeout(() => active.get(runId)?.controller.abort("timeout"), remaining);
  const pauseTimer = () => { clearTimeout(timer); remaining -= Date.now() - timerStarted; };
  const resumeTimer = () => { timerStarted = Date.now(); timer = setTimeout(() => active.get(runId)?.controller.abort("timeout"), Math.max(remaining, 0)); };
  const onAbort = () => { void browser.closeSession(session); };
  signal.addEventListener("abort", onAbort);

  const waitForDecision = (repairId: string) => new Promise<Decision | "expired">((resolve, reject) => {
    const expire = setTimeout(() => resolve("expired"), approvalTimeoutMs);
    signal.addEventListener("abort", () => { clearTimeout(expire); reject(new Error("aborted")); }, { once: true });
    active.get(runId)!.pending = { repairId, resolve: (d: Decision) => { clearTimeout(expire); resolve(d); } };
  }).finally(() => { const a = active.get(runId); if (a) a.pending = undefined; });

  /** Bounded AI-guided recovery for a locator failure. Returns the repaired step or throws StepFailure. */
  async function recover(i: number, step: LocatorStep, error: string, evidence?: string): Promise<{ step: LocatorStep; repairId: string }> {
    await move("recovering");
    await save();
    const base = { runId, stepIndex: i, attempt: recoveries, action: step.action, failedSelector: step.selector, error, failureEvidence: evidence };
    const ctx: RepairContext = {
      task, step, stepNumber: i + 1, error,
      resolvedValue: step.action === "select" ? t(step.value) : undefined,
      postconditions: def.steps.filter((s) => s.action === "assert").map((s) => `${s.description} (${stepTarget(s)})`),
    };
    const before = { ...usage };
    const spent = () => JSON.stringify({ modelCalls: usage.modelCalls - before.modelCalls, inputTokens: usage.inputTokens - before.inputTokens, outputTokens: usage.outputTokens - before.outputTokens });
    let result;
    try {
      result = await proposer(session!, ctx, usage, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      const reason = redact(err instanceof Error ? err.message : String(err));
      await db.repair.create({ data: { ...base, decision: "error", decisionReason: reason, outcome: "not_applied", usage: spent() } });
      throw new StepFailure(`Recovery could not run: ${reason}`);
    }
    if (result.kind === "none") {
      await db.repair.create({ data: { ...base, decision: "no_safe_repair", decisionReason: result.reason, outcome: "not_applied", usage: spent() } });
      throw new StepFailure(`Recovery stopped safely: ${result.reason}`);
    }
    const { proposal } = result;
    // Re-validate in the engine regardless of what the proposer claims.
    const check = await checkProposal(session!, ctx, proposal);
    const fields = { ...base, proposedSelector: proposal.selector, rationale: proposal.rationale, confidence: proposal.confidence, validation: JSON.stringify(check.errors), matched: "error" in check.el ? null : JSON.stringify(check.el), usage: spent() };
    if (check.errors.length) {
      await db.repair.create({ data: { ...fields, decision: "invalid", decisionReason: check.errors.join(" "), outcome: "not_applied" } });
      throw new StepFailure(`Recovery proposal rejected by engine: ${check.errors.join(" ")}`);
    }
    const d = decideRepair(step.action, def.recoveryPolicy, proposal);
    const repair = await db.repair.create({ data: { ...fields, decision: d.decision, decisionReason: d.reason, decidedAt: d.decision === "auto_approved" ? new Date() : null } });
    if (d.decision === "pending") {
      await move("needs_approval");
      await save();
      pauseTimer();
      const answer = await waitForDecision(repair.id);
      resumeTimer();
      await db.repair.update({ where: { id: repair.id }, data: { decision: answer, decidedAt: new Date(), ...(answer !== "approved" ? { outcome: "not_applied" } : {}) } });
      if (answer === "rejected") throw new StepFailure("Reviewer rejected the proposed repair; nothing was changed.");
      if (answer === "expired") throw new StepFailure(`No decision on the proposed repair within ${approvalTimeoutMs / 60000} min; stopped.`);
    }
    await move("running");
    return { step: { ...step, selector: proposal.selector } as LocatorStep, repairId: repair.id };
  }

  try {
    await mkdir(dir, { recursive: true });
    await move("running", { startedAt: new Date() });
    if (def.steps.length > maxSteps) throw new StepFailure(`Workflow has ${def.steps.length} steps; the per-run limit is ${maxSteps}.`);
    // Effective allowlist: the workflow's own prefixes, but only those still allowed by server config.
    const prefixes = def.allowedPrefixes.filter((p) => isUrlAllowed(p, globalPrefixes()));
    if (!prefixes.length) throw new StepFailure("None of this workflow's permitted URLs are in the server allowlist any more.");
    session = await browser.openSession(prefixes);

    for (const [i, original] of def.steps.entries()) {
      const entry = log[i];
      let step: Step = original;
      let repairId: string | null = null;
      Object.assign(entry, { status: "running", startedAt: new Date().toISOString() });
      await save();
      while (true) {
        if (signal.aborted) throw new Error("aborted");
        entry.attempts++;
        try {
          entry.observed = redact(await runStep(session, step, t, data, dir, i, (c) => {
            checks.push({ step: i + 1, description: step.description, ...c });
            if (!c.passed) throw new StepFailure(`Verification failed: ${c.detail}`);
          }));
          break;
        } catch (err) {
          if (signal.aborted) throw err;
          const message = redact(err instanceof Error ? err.message.split("\n")[0] : String(err));
          const evidence = await snap(`step-${i + 1}-attempt-${entry.attempts}.png`);
          entry.failures.push({ attempt: entry.attempts, error: message, evidence });
          if (repairId) await db.repair.update({ where: { id: repairId }, data: { outcome: "failed", outcomeDetail: message } });
          await save();
          const recoverable = err instanceof browser.LocatorError && RECOVERABLE.has(step.action) && "selector" in step;
          if (!recoverable) throw new StepFailure(`Step ${i + 1} (${step.action} ${stepTarget(step)}) failed: ${message}`);
          if (recoveries >= maxRecoveries) throw new StepFailure(`Step ${i + 1} failed: ${message}. Recovery budget exhausted (${maxRecoveries} per run).`);
          recoveries++;
          ({ step, repairId } = await recover(i, step as LocatorStep, message, evidence));
          entry.repairedSelector = (step as LocatorStep).selector;
          entry.target = stepTarget(step);
        }
      }
      if (step.action === "download") { csvFile = "export.csv"; lastEvidence = csvFile; }
      if (step.action === "screenshot") { lastEvidence = `step-${i + 1}.png`; entry.evidence = lastEvidence; }
      if (repairId) await db.repair.update({ where: { id: repairId }, data: { outcome: "verified", outcomeDetail: `Repaired step executed: ${entry.observed}` } });
      Object.assign(entry, { status: "ok", finishedAt: new Date().toISOString() });
      await save();
      await db.checkpoint.create({
        data: {
          runId, workflowVersion: def.version, stepIndex: i, evidence: lastEvidence,
          state: JSON.stringify({ steps: log.map((l) => ({ index: l.index, status: l.status, attempts: l.attempts })), checks }),
        },
      });
    }
    await snap("final.png");
    await move("succeeded", { finishedAt: new Date() });
  } catch (err) {
    const timedOut = signal.aborted && signal.reason === "timeout";
    const error = signal.aborted
      ? timedOut ? `Run exceeded the ${timeoutMs / 1000}s time limit and was stopped.` : "Cancelled by user."
      : redact(err instanceof Error ? err.message : String(err));
    if (!signal.aborted) await snap("final.png");
    const current = log.find((l) => l.status === "running");
    if (current) Object.assign(current, { status: "failed", finishedAt: new Date().toISOString() });
    for (const l of log) if (l.status === "pending") l.status = "skipped";
    await save().catch(() => {});
    await move(signal.aborted && !timedOut ? "cancelled" : "failed", { error, finishedAt: new Date() })
      .catch((e) => console.error(`Run ${runId}: could not record final state`, e));
    await db.repair.updateMany({ where: { runId, decision: "pending" }, data: { decision: "expired", decisionReason: error } }).catch(() => {});
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    await browser.closeSession(session);
  }
}

async function runStep(
  s: browser.Session,
  step: Step,
  t: (text: string) => string,
  data: { table?: Table; csv?: Table },
  dir: string,
  i: number,
  record: (c: { passed: boolean; detail: string }) => void,
): Promise<string> {
  switch (step.action) {
    case "navigate": return browser.navigate(s, t(step.url));
    case "fill": return browser.fill(s, step.selector, t(step.value));
    case "select": return browser.selectOption(s, step.selector, t(step.value));
    case "click": return browser.click(s, step.selector);
    case "wait": return browser.waitFor(s, step.selector, step.text && t(step.text));
    case "extract":
      data.table = await browser.extractTable(s, step.selector);
      return `Extracted ${data.table.rows.length} rows × ${data.table.headers.length} columns (${data.table.headers.join(", ")})`;
    case "download":
      data.csv = await browser.download(s, step.selector, path.join(dir, "export.csv"));
      return `Downloaded CSV: ${data.csv.rows.length} rows, headers ${data.csv.headers.join(", ")}`;
    case "screenshot":
      await browser.screenshot(s, path.join(dir, `step-${i + 1}.png`));
      return "Screenshot captured";
    case "assert": {
      const c = step.check;
      if (c.type === "visible") {
        const ok = await s.page.locator(c.selector).first().isVisible();
        record({ passed: ok, detail: ok ? `${c.selector} is visible.` : `${c.selector} is not visible.` });
        return `${c.selector} is visible`;
      }
      const result = evaluateCheck(c.type === "everyRow" ? { ...c, value: t(c.value) } : c, data);
      record(result);
      return result.detail;
    }
  }
}
