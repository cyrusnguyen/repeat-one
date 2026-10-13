import type { CheckLog, StepLog } from "./store";

export type RunView = {
  status: string;
  error: string | null;
  log: StepLog[];
  checks: CheckLog[];
  csvRows: number | null;
  repairs: { stepIndex: number; decision: string; outcome: string }[];
};
export type Tone = "gold" | "ok" | "bad" | "muted";
export type Stage = { key: "plan" | "run" | "break" | "repair" | "verify"; label: string; caption: string; state: "done" | "active" | "broken" | "verified" | "pending" | "none" };
export type StepGroup = { kind: "step"; step: StepLog } | { kind: "group"; status: "ok" | "skipped" | "pending"; steps: StepLog[] };

const ACTIVE = new Set(["queued", "running", "recovering", "needs_approval"]);
const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function runHeadline(r: RunView): { title: string; tone: Tone } {
  const applied = r.repairs.some((x) => x.outcome === "verified");
  const rows = r.csvRows === null ? "" : ` · ${r.csvRows} rows exported`;
  switch (r.status) {
    case "queued": return { title: "Queued", tone: "muted" };
    case "running": {
      const current = r.log.findIndex((l) => l.status === "running" || l.status === "pending");
      return { title: `Running step ${current < 0 ? r.log.length : current + 1} of ${r.log.length}`, tone: "gold" };
    }
    case "recovering": return { title: "Investigating a changed page", tone: "gold" };
    case "needs_approval": return { title: "Your decision: approve this repair?", tone: "gold" };
    case "succeeded": return { title: `${applied ? "Repaired and verified" : "Verified"}${rows}`, tone: "ok" };
    case "cancelled": return { title: "Cancelled", tone: "muted" };
    default: {
      const safe = r.repairs.some((x) => x.decision === "no_safe_repair");
      const reason = r.error ? firstSentence(r.error.replace(/^Recovery stopped safely:\s*/, "")) : "the run did not complete.";
      return { title: `${safe ? "Stopped safely" : "Stopped"}: ${reason}`, tone: "bad" };
    }
  }
}

export function runStages(r: RunView, version: number): Stage[] {
  const active = ACTIVE.has(r.status);
  const ok = r.log.filter((l) => l.status === "ok").length;
  const broke = r.log.filter((l) => l.failures.length > 0).length;
  const auto = r.repairs.filter((x) => x.decision === "auto_approved" && x.outcome === "verified").length;
  const approved = r.repairs.filter((x) => x.decision === "approved" && x.outcome === "verified").length;
  const passed = r.checks.filter((c) => c.passed).length;

  const repair: Stage = { key: "repair", label: "Repair", caption: "none", state: active ? "pending" : "none" };
  if (r.repairs.some((x) => x.decision === "pending")) Object.assign(repair, { state: "active", caption: "waiting for you" });
  else if (r.status === "recovering") Object.assign(repair, { state: "active", caption: "investigating" });
  else if (auto + approved > 0) Object.assign(repair, { state: "done", caption: [auto && `${auto} auto`, approved && `${approved} approved`].filter(Boolean).join(" · ") });
  else if (r.repairs.length) {
    const last = r.repairs[r.repairs.length - 1].decision;
    Object.assign(repair, { state: "broken", caption: last === "no_safe_repair" ? "no safe repair" : last === "rejected" ? "rejected" : "not applied" });
  }

  const verify: Stage = { key: "verify", label: "Verify", caption: "pending", state: "pending" };
  if (r.status === "succeeded") Object.assign(verify, { state: "verified", caption: `${passed}/${r.checks.length} passed` });
  // A stop before the end is "not reached" unless a check itself failed.
  else if (r.status === "failed") Object.assign(verify, { state: "broken", caption: passed < r.checks.length ? `${passed}/${r.checks.length} passed` : "not reached" });
  else if (r.status === "cancelled") Object.assign(verify, { state: "none", caption: "cancelled" });

  return [
    { key: "plan", label: "Plan", caption: `v${version} approved`, state: "done" },
    { key: "run", label: "Run", caption: `${ok} of ${r.log.length} steps`, state: active ? "active" : "done" },
    { key: "break", label: "Break", caption: broke ? `${plural(broke, "step")} failed` : active ? "so far none" : "none", state: broke ? "broken" : active ? "pending" : "none" },
    repair,
    verify,
  ];
}

/** Fold consecutive uneventful steps; anything that failed, was repaired or is running stays on its own. */
export function groupSteps(log: StepLog[]): StepGroup[] {
  // With nothing eventful, folding would collapse the whole story into one card.
  const eventful = log.some((l) => l.failures.length || l.repairedSelector || l.status === "running" || l.status === "failed");
  if (!eventful) return log.map((step) => ({ kind: "step", step }));
  const out: StepGroup[] = [];
  const quiet =(l: StepLog) => (l.status === "ok" && !l.failures.length && !l.repairedSelector) || l.status === "skipped" || l.status === "pending";
  for (const l of log) {
    const prev = out[out.length - 1];
    if (quiet(l) && prev?.kind === "group" && prev.status === l.status) prev.steps.push(l);
    else if (quiet(l) && prev?.kind === "step" && quiet(prev.step) && prev.step.status === l.status) out[out.length - 1] = { kind: "group", status: l.status as "ok", steps: [prev.step, l] };
    else out.push({ kind: "step", step: l });
  }
  return out;
}
