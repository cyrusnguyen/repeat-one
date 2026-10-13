import { describe, expect, it } from "vitest";
import { groupSteps, runHeadline, runStages, type RunView } from "./run-view";
import type { StepLog } from "./store";

const step = (index: number, status: StepLog["status"], extra: Partial<StepLog> = {}): StepLog => ({
  index, action: "fill", target: `#s${index}`, description: `Step ${index + 1}`, status, attempts: status === "pending" ? 0 : 1, failures: [], ...extra,
});
const base = (over: Partial<RunView>): RunView => ({ status: "succeeded", error: null, log: [], checks: [], csvRows: null, repairs: [], ...over });
const stage = (r: RunView, key: string) => runStages(r, 1).find((s) => s.key === key)!;

describe("runHeadline", () => {
  it("clean success", () => {
    expect(runHeadline(base({ csvRows: 9 }))).toEqual({ title: "Verified · 9 rows exported", tone: "ok" });
  });
  it("success with applied repairs", () => {
    const r = base({ csvRows: 4, repairs: [{ stepIndex: 4, decision: "auto_approved", outcome: "verified" }] });
    expect(runHeadline(r).title).toBe("Repaired and verified · 4 rows exported");
  });
  it("running shows the current step", () => {
    const r = base({ status: "running", log: [step(0, "ok"), step(1, "running"), step(2, "pending")] });
    expect(runHeadline(r)).toEqual({ title: "Running step 2 of 3", tone: "gold" });
  });
  it("needs approval and recovering", () => {
    expect(runHeadline(base({ status: "needs_approval" })).title).toBe("Your decision: approve this repair?");
    expect(runHeadline(base({ status: "recovering" })).title).toBe("Investigating a changed page");
  });
  it("safe stop strips the prefix and keeps the first sentence", () => {
    const r = base({ status: "failed", error: "Recovery stopped safely: The page has no CSV export. More detail here.", repairs: [{ stepIndex: 12, decision: "no_safe_repair", outcome: "not_applied" }] });
    expect(runHeadline(r)).toEqual({ title: "Stopped safely: The page has no CSV export.", tone: "bad" });
  });
  it("failure without an error message", () => {
    expect(runHeadline(base({ status: "failed", error: null })).title).toBe("Stopped: the run did not complete.");
  });
  it("cancelled", () => expect(runHeadline(base({ status: "cancelled" }))).toEqual({ title: "Cancelled", tone: "muted" }));
});

describe("runStages", () => {
  it("clean run: nothing broke, nothing repaired, verified", () => {
    const r = base({ log: [step(0, "ok"), step(1, "ok")], checks: [{ step: 2, description: "c", passed: true, detail: "" }] });
    expect(stage(r, "break")).toMatchObject({ state: "none", caption: "none" });
    expect(stage(r, "repair")).toMatchObject({ state: "none", caption: "none" });
    expect(stage(r, "verify")).toMatchObject({ state: "verified", caption: "1/1 passed" });
    expect(stage(r, "plan").caption).toBe("v1 approved");
  });
  it("repaired run", () => {
    const r = base({
      log: [step(0, "ok", { attempts: 2, failures: [{ attempt: 1, error: "x" }], repairedSelector: "#a" }), step(1, "ok", { attempts: 2, failures: [{ attempt: 1, error: "y" }], repairedSelector: "#b" })],
      repairs: [{ stepIndex: 0, decision: "auto_approved", outcome: "verified" }, { stepIndex: 1, decision: "approved", outcome: "verified" }],
    });
    expect(stage(r, "break")).toMatchObject({ state: "broken", caption: "2 steps failed" });
    expect(stage(r, "repair")).toMatchObject({ state: "done", caption: "1 auto · 1 approved" });
  });
  it("waiting for a decision", () => {
    const r = base({ status: "needs_approval", log: [step(0, "running", { failures: [{ attempt: 1, error: "x" }] })], repairs: [{ stepIndex: 0, decision: "pending", outcome: "pending" }] });
    expect(stage(r, "repair")).toMatchObject({ state: "active", caption: "waiting for you" });
    expect(stage(r, "verify")).toMatchObject({ state: "pending" });
  });
  it("a stopped run whose earlier checks passed says verify was not reached, not 5/5 passed", () => {
    const r = base({ status: "failed", checks: [{ step: 2, description: "c", passed: true, detail: "" }], log: [step(0, "failed", { failures: [{ attempt: 1, error: "x" }] })] });
    expect(stage(r, "verify")).toMatchObject({ state: "broken", caption: "not reached" });
  });
  it("a failed check is reported with the count", () => {
    const r = base({ status: "failed", checks: [{ step: 2, description: "a", passed: true, detail: "" }, { step: 3, description: "b", passed: false, detail: "" }] });
    expect(stage(r, "verify")).toMatchObject({ state: "broken", caption: "1/2 passed" });
  });
  it("in progress: verify pending, run active", () => {
    const r = base({ status: "running", log: [step(0, "ok"), step(1, "running")] });
    expect(stage(r, "run")).toMatchObject({ state: "active", caption: "1 of 2 steps" });
    expect(stage(r, "verify").state).toBe("pending");
    expect(stage(r, "break").state).toBe("pending");
  });
  it("safe stop: repair broken, verify not reached", () => {
    const r = base({ status: "failed", log: [step(0, "failed", { failures: [{ attempt: 1, error: "x" }] })], repairs: [{ stepIndex: 0, decision: "no_safe_repair", outcome: "not_applied" }] });
    expect(stage(r, "repair")).toMatchObject({ state: "broken", caption: "no safe repair" });
    expect(stage(r, "verify")).toMatchObject({ state: "broken", caption: "not reached" });
  });
});

describe("groupSteps", () => {
  it("folds uneventful ok and skipped runs, never failed or repaired steps", () => {
    const log = [step(0, "ok"), step(1, "ok"), step(2, "ok", { repairedSelector: "#x", attempts: 2, failures: [{ attempt: 1, error: "e" }] }), step(3, "ok"), step(4, "failed"), step(5, "skipped"), step(6, "skipped"), step(7, "skipped")];
    const g = groupSteps(log);
    expect(g.map((x) => (x.kind === "group" ? `${x.status}:${x.steps.length}` : `step:${x.step.index}`))).toEqual(["ok:2", "step:2", "step:3", "step:4", "skipped:3"]);
  });
  it("empty log", () => expect(groupSteps([])).toEqual([]));
  it("a clean finished run shows every step, so the story is not one folded card", () => {
    const g = groupSteps([step(0, "ok"), step(1, "ok"), step(2, "ok")]);
    expect(g.map((x) => x.kind)).toEqual(["step", "step", "step"]);
  });
  it("a running run still folds the steps not started yet", () => {
    const g = groupSteps([step(0, "ok"), step(1, "running"), step(2, "pending"), step(3, "pending")]);
    expect(g.map((x) => (x.kind === "group" ? `${x.status}:${x.steps.length}` : `step:${x.step.index}`))).toEqual(["step:0", "step:1", "pending:2"]);
  });
});
