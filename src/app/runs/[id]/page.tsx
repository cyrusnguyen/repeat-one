"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, Square, Play } from "lucide-react";
import { api, duration } from "@/lib/client";
import { parseCsv, type Table } from "@/lib/checks";
import { groupSteps, runHeadline, runStages, type RunView } from "@/lib/run-view";
import { isActive } from "@/lib/state";
import type { CheckLog, StepLog } from "@/lib/store";
import { TopBar } from "@/components/TopBar";
import { StatusPill } from "@/components/StatusPill";
import { StagePipeline } from "@/components/StagePipeline";
import { EvidenceDrawer, type Repair } from "@/components/EvidenceDrawer";

type RunData = {
  id: string; status: string; error: string | null; csvFile: string | null; workflowVersion: number; checkpoints: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  inputs: Record<string, string>; log: StepLog[]; checks: CheckLog[]; repairs: Repair[];
  usage: { modelCalls?: number; estimatedCostUsd?: number };
  workflow: { id: string; name: string };
};

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<Table | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[] | null>(null);
  const openers = useRef(new Map<number, HTMLButtonElement | null>());
  const art = useCallback((name: string) => `/api/runs/${id}/artifacts/${name}`, [id]);

  const load = useCallback(() => api<RunData>(`/api/runs/${id}`).then((r) => { setRun(r); setError(null); }, (e: Error) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const active = run ? isActive(run.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [active, load]);

  useEffect(() => {
    if (!run?.csvFile || active) return;
    fetch(art(run.csvFile)).then((r) => (r.ok ? r.text() : Promise.reject(new Error("CSV unavailable")))).then((t) => setCsv(parseCsv(t)), () => setCsv(null));
  }, [run?.csvFile, active, art]);

  // A repair waiting for a human opens its evidence automatically.
  const pending = run?.status === "needs_approval" ? run.repairs.find((r) => r.decision === "pending") : undefined;
  const [shownPending, setShownPending] = useState<string | null>(null);
  if (pending && shownPending !== pending.id) {
    setShownPending(pending.id);
    setSelected([pending.stepIndex]);
  }

  const close = useCallback(() => {
    setSelected((sel) => {
      if (sel) openers.current.get(sel[0])?.focus();
      return null;
    });
  }, []);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); await load(); }
  }

  if (!run) {
    return (
      <>
        <TopBar crumbs={[{ label: "Workflows", href: "/" }, { label: "Run" }]} />
        <main className="page">{error ? <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span>{error}</span></p> : <p className="muted"><Loader2 className="spin" aria-hidden style={{ width: 14, verticalAlign: -2 }} /> Loading run…</p>}</main>
      </>
    );
  }

  const view: RunView = { status: run.status, error: run.error, log: run.log, checks: run.checks, csvRows: csv ? csv.rows.length : null, repairs: run.repairs };
  const headline = runHeadline(view);
  const repaired = run.repairs.filter((r) => r.outcome === "verified").length;
  const passed = run.checks.filter((c) => c.passed).length;
  const selectedSteps = selected ? run.log.filter((l) => selected.includes(l.index)) : [];
  const drawerTitle = selectedSteps.length === 1 ? `Step ${selectedSteps[0].index + 1} · ${selectedSteps[0].description}` : `Steps ${selected?.[0] !== undefined ? selected[0] + 1 : ""}-${selected?.[selected.length - 1] !== undefined ? selected[selected.length - 1] + 1 : ""}`;

  return (
    <div className={selected ? "has-drawer" : undefined}>
      <TopBar crumbs={[{ label: "Workflows", href: "/" }, { label: run.workflow.name, href: `/workflows/${run.workflow.id}` }, { label: "Run" }]}>
        {active
          ? <button className="btn" disabled={busy === "cancel"} onClick={() => act("cancel", () => api(`/api/runs/${id}/cancel`, { body: {} }))}><Square aria-hidden /> {busy === "cancel" ? "Cancelling…" : "Cancel run"}</button>
          : <Link className="btn" href={`/workflows/${run.workflow.id}`}><Play aria-hidden /> Run again</Link>}
      </TopBar>

      <main className="page">
        <header className="stack" style={{ gap: 6 }}>
          <div className="row"><StatusPill status={run.status} /><span className="hint mono">v{run.workflowVersion} · {run.id}</span></div>
          <h1 className="h1" style={headline.tone === "bad" ? { color: "#ffc1b8" } : undefined}>
            {headline.tone === "gold" && <Loader2 className="spin" aria-hidden style={{ width: 20, verticalAlign: -2, marginRight: 8, color: "var(--gold)" }} />}
            {headline.title}
          </h1>
          <p className="lead mono" style={{ fontSize: 12.5 }}>
            {[
              ...Object.entries(run.inputs).map(([k, v]) => `${k} = ${v}`),
              duration(run.startedAt, run.finishedAt),
              repaired ? `${repaired} repair${repaired === 1 ? "" : "s"}` : null,
              run.checks.length ? `${passed} of ${run.checks.length} checks passed` : null,
              run.usage.modelCalls ? `Opus ≈ $${run.usage.estimatedCostUsd?.toFixed(3)}` : null,
              `${run.checkpoints} checkpoints`,
            ].filter(Boolean).join(" · ")}
          </p>
        </header>

        {(run.status === "failed" || run.status === "cancelled") && (
          <div className={`callout ${run.status === "failed" ? "danger" : "warning"}`} role="alert">
            <AlertTriangle aria-hidden />
            <div className="stack" style={{ gap: 10 }}>
              <span>{run.error ?? "Run did not complete."}</span>
              {run.status === "failed" && (
                <span className="row">
                  <span className="hint" style={{ color: "inherit" }}>Nothing was guessed. The saved workflow never changes automatically.</span>
                  <Link className="btn" href={`/workflows/${run.workflow.id}`}><RefreshCw aria-hidden /> Review / re-plan</Link>
                </span>
              )}
            </div>
          </div>
        )}
        {error && <p className="callout danger"><AlertTriangle aria-hidden /><span>{error}</span></p>}

        <StagePipeline stages={runStages(view, run.workflowVersion)} />

        <ol className="timeline" aria-label="Steps">
          {groupSteps(run.log).map((g) => {
            const steps = g.kind === "group" ? g.steps : [g.step];
            const first = steps[0], last = steps[steps.length - 1];
            const indices = steps.map((s) => s.index);
            const isSelected = !!selected && selected[0] === first.index && selected.length === indices.length;
            const open = () => setSelected(isSelected ? null : indices);
            if (g.kind === "group") {
              const label = g.status === "ok" ? `${first.description} … ${last.description}` : g.status === "skipped" ? "Not reached" : "Not started yet";
              return (
                <li key={`g${first.index}`}>
                  <button ref={(el) => { openers.current.set(first.index, el); }} className={`step-card quiet${isSelected ? " selected" : ""}`} onClick={open}>
                    <span className="n">{first.index + 1}-{last.index + 1}</span>
                    <span>{label}</span>
                    <span className="meta"><StatusPill status={g.status} /></span>
                  </button>
                </li>
              );
            }
            const s = g.step;
            const repair = run.repairs.filter((r) => r.stepIndex === s.index).at(-1);
            const waiting = repair?.decision === "pending" && run.status === "needs_approval";
            const lastFailure = s.failures.at(-1);
            const cls = ["step-card", waiting ? "attention" : "", s.status === "failed" ? "failed" : "", isSelected ? "selected" : ""].filter(Boolean).join(" ");
            return (
              <li key={s.index}>
                <button ref={(el) => { openers.current.set(s.index, el); }} className={cls} onClick={open} aria-label={`Step ${s.index + 1}: ${s.description}`}>
                  <span className="n">{s.index + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600 }}>{s.description}</span>
                    <span className="mono muted" style={{ display: "block", overflowWrap: "anywhere" }}>{s.action} {s.target}</span>
                    {repair?.proposedSelector && (repair.outcome === "verified" || waiting) && (
                      <span className="diff" style={{ display: "block" }}><s>{repair.failedSelector}</s> → <ins>{repair.proposedSelector}</ins>{s.attempts > 1 && <span className="muted"> · {s.attempts} attempts</span>}</span>
                    )}
                    {s.status === "failed" && lastFailure && <span className="mono" style={{ display: "block", color: "var(--bad)", marginTop: 4 }}>attempt {lastFailure.attempt} failed: {lastFailure.error}</span>}
                    {waiting && <span style={{ display: "block", color: "var(--gold)", marginTop: 4 }}>Waiting for your decision →</span>}
                  </span>
                  <span className="meta">
                    {repair ? <StatusPill status={repair.decision} /> : <StatusPill status={s.status} />}
                    {s.startedAt && <span className="hint mono">{duration(s.startedAt, s.finishedAt)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {csv && run.csvFile && (
          <section className="card stack" style={{ gap: 12 }}>
            <div className="spread">
              <h2 className="eyebrow">Exported CSV · {csv.rows.length} rows</h2>
              <a className="btn" href={art(run.csvFile)} download><Download aria-hidden /> Download CSV</a>
            </div>
            <div className="scroll-x">
              <table className="data">
                <thead><tr>{csv.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{csv.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {csv.rows.length === 0 && <p className="muted">The export has headers but no rows for these inputs.</p>}
          </section>
        )}
      </main>

      {selected && (
        <EvidenceDrawer
          title={drawerTitle}
          steps={selectedSteps}
          repairs={run.repairs}
          checks={run.checks}
          csv={csv}
          finalShot={active ? null : "final.png"}
          art={art}
          decisionOpen={run.status === "needs_approval"}
          busy={!!busy}
          onClose={close}
          onDecide={(repairId, decision) => act(decision, () => api(`/api/runs/${id}/repairs/${repairId}`, { body: { decision } }))}
        />
      )}
    </div>
  );
}
