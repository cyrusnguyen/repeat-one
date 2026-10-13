import { mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import * as browser from "./browser";
import { evaluateCheck, type Table } from "./checks";
import { fillTemplate, resolveInputs, stepTarget, type Step } from "./schemas";
import { globalPrefixes, isUrlAllowed, redact } from "./safety";
import { parseWorkflow, type CheckLog, type StepLog } from "./store";

export const ARTIFACT_ROOT = path.resolve(process.cwd(), "data", "artifacts");

type Active = { workflowId: string; controller: AbortController };
// Survives Next dev hot reloads; single local process is the documented deployment.
const g = globalThis as unknown as { runs?: Map<string, Active>; starting?: Set<string> };
const active = (g.runs ??= new Map());
const starting = (g.starting ??= new Set());

export class RunConflict extends Error {
  constructor(public runId: string) { super("This workflow already has a run in progress."); }
}

/** Starts a run of the saved, approved definition. At most one active run per workflow. */
export async function startRun(workflowId: string, rawInputs: Record<string, unknown>): Promise<string> {
  for (const [runId, a] of active) if (a.workflowId === workflowId) throw new RunConflict(runId);
  if (starting.has(workflowId)) throw new RunConflict("");
  starting.add(workflowId);
  try {
    const row = await db.workflow.findUnique({ where: { id: workflowId } });
    if (!row) throw new Error("Workflow not found.");
    if (row.status !== "approved") throw new Error("This plan has not been approved. Review and approve it before running.");
    const wf = parseWorkflow(row);
    const values = resolveInputs(wf.inputs, rawInputs);
    const run = await db.run.create({ data: { workflowId, inputs: JSON.stringify(values), status: "queued" } });
    const controller = new AbortController();
    active.set(run.id, { workflowId, controller });
    void execute(run.id, wf.steps, wf.allowedPrefixes, values, controller.signal).finally(() => active.delete(run.id));
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

/** A queued/running row with no live executor was orphaned by a restart; record that truthfully. */
export async function reconcileRun<T extends { id: string; status: string }>(run: T): Promise<T> {
  if ((run.status === "queued" || run.status === "running") && !active.has(run.id)) {
    const error = "Interrupted: the server stopped while this run was in progress.";
    await db.run.update({ where: { id: run.id }, data: { status: "failed", error, finishedAt: new Date() } });
    return { ...run, status: "failed", error };
  }
  return run;
}

async function execute(runId: string, steps: Step[], workflowPrefixes: string[], values: Record<string, string>, signal: AbortSignal) {
  const dir = path.join(ARTIFACT_ROOT, runId);
  const log: StepLog[] = steps.map((s, index) => ({ index, action: s.action, target: stepTarget(s), description: s.description, status: "pending" }));
  const checks: CheckLog[] = [];
  const data: { table?: Table; csv?: Table } = {};
  let csvFile: string | null = null;
  let failure: string | null = null;
  let session: browser.Session | undefined;
  const save = (extra: Record<string, unknown> = {}) =>
    db.run.update({ where: { id: runId }, data: { log: JSON.stringify(log), checks: JSON.stringify(checks), csvFile, ...extra } });

  const timeoutMs = Number(process.env.RUN_TIMEOUT_MS || 60_000);
  const maxSteps = Number(process.env.MAX_RUN_STEPS || 30);
  const timer = setTimeout(() => active.get(runId)?.controller.abort("timeout"), timeoutMs);
  // Closing the browser makes any in-flight Playwright call reject immediately.
  const onAbort = () => void browser.closeSession(session);
  signal.addEventListener("abort", onAbort);

  try {
    await mkdir(dir, { recursive: true });
    await save({ status: "running", startedAt: new Date() });
    if (steps.length > maxSteps) throw new Error(`Workflow has ${steps.length} steps; the per-run limit is ${maxSteps}.`);
    // Effective allowlist: the workflow's own prefixes, but only those still allowed by server config.
    const prefixes = workflowPrefixes.filter((p) => isUrlAllowed(p, globalPrefixes()));
    if (!prefixes.length) throw new Error("None of this workflow's permitted URLs are in the server allowlist any more.");
    session = await browser.openSession(prefixes);

    for (const [i, step] of steps.entries()) {
      if (signal.aborted) break;
      Object.assign(log[i], { status: "running", startedAt: new Date().toISOString() });
      await save();
      try {
        log[i].observed = redact(await runStep(session, step, values, data, dir, i, (c) => {
          checks.push({ step: i + 1, description: step.description, ...c });
          if (!c.passed) throw new Error(`Verification failed: ${c.detail}`);
        }));
        if (step.action === "download") csvFile = "export.csv";
        if (step.action === "screenshot") log[i].screenshot = `step-${i + 1}.png`;
        log[i].status = "ok";
      } catch (err) {
        if (signal.aborted) break;
        const message = redact(err instanceof Error ? err.message.split("\n")[0] : String(err));
        Object.assign(log[i], { status: "failed", observed: message });
        failure = `Step ${i + 1} (${step.action} ${log[i].target}) failed: ${message}`;
        break;
      } finally {
        log[i].finishedAt = new Date().toISOString();
      }
    }
  } catch (err) {
    failure = redact(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (session && !signal.aborted) {
      await browser.screenshot(session, path.join(dir, "final.png")).catch(() => {});
    }
    await browser.closeSession(session);
    for (const l of log) if (l.status === "pending" || l.status === "running") l.status = "skipped";
    const status = signal.aborted ? (signal.reason === "timeout" ? "failed" : "cancelled") : failure ? "failed" : "succeeded";
    const error = signal.aborted
      ? signal.reason === "timeout" ? `Run exceeded the ${timeoutMs / 1000}s time limit and was stopped.` : "Cancelled by user."
      : failure;
    await save({ status, error, finishedAt: new Date() }).catch((e) => console.error("Failed to save run result", e));
  }
}

async function runStep(
  s: browser.Session,
  step: Step,
  values: Record<string, string>,
  data: { table?: Table; csv?: Table },
  dir: string,
  i: number,
  record: (c: { passed: boolean; detail: string }) => void,
): Promise<string> {
  const t = (text: string) => fillTemplate(text, values);
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
