"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Download, Loader2, RefreshCw, ShieldAlert, Square, Wrench, X, XCircle } from "lucide-react";
import { api, duration, when } from "@/lib/client";
import { parseCsv, type Table } from "@/lib/checks";
import { StatusPill as StatusTag } from "@/components/StatusPill";
import { isActive } from "@/lib/state";
import type { CheckLog, StepLog } from "@/lib/store";

type Repair = {
  id: string; stepIndex: number; attempt: number; action: string; failedSelector: string; error: string; failureEvidence: string | null;
  proposedSelector: string | null; rationale: string; confidence: string | null; validation: string[]; matched: { tag?: string; label?: string; id?: string } | null;
  decision: string; decisionReason: string; outcome: string; outcomeDetail: string; usage: { modelCalls?: number }; createdAt: string; decidedAt: string | null;
};
type RunData = {
  id: string; status: string; error: string | null; csvFile: string | null; workflowVersion: number; checkpoints: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  inputs: Record<string, string>; log: StepLog[]; checks: CheckLog[]; repairs: Repair[];
  usage: { modelCalls?: number; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
  workflow: { id: string; name: string };
};

function Evidence({ src, alt }: { src: string; alt: string }) {
  return <a href={src} target="_blank" rel="noreferrer"><img className="shot" src={src} alt={alt} style={{ marginTop: 6, maxHeight: 200 }} /></a>;
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<Table | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noFinalShot, setNoFinalShot] = useState(false);
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

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); await load(); }
  }

  if (!run) {
    return <div className="page">{error ? <p className="callout danger" role="alert"><AlertTriangle aria-hidden />{error}</p> : <p className="muted"><Loader2 className="spin" aria-hidden /> Loading run…</p>}</div>;
  }
  const done = run.log.filter((l) => l.status === "ok").length;
  const repaired = run.log.filter((l) => l.repairedSelector).length;
  const pending = run.repairs.find((r) => r.decision === "pending");

  return (
    <div className="split">
      <div className="page">
        <div className="spread">
          <div style={{ display: "grid", gap: 4 }}>
            <Link href={`/workflows/${run.workflow.id}`} className="hint">← {run.workflow.name}</Link>
            <div className="row"><h1>Run</h1><StatusTag status={run.status} /><span className="hint mono">v{run.workflowVersion} · {run.id}</span></div>
          </div>
          {active && (
            <button className="btn danger" disabled={busy === "cancel"} onClick={() => act("cancel", () => api(`/api/runs/${id}/cancel`, { body: {} }))}>
              <Square aria-hidden /> {busy === "cancel" ? "Cancelling…" : "Cancel run"}
            </button>
          )}
        </div>

        {(run.status === "queued" || run.status === "running") && <p className="callout info" role="status"><Loader2 className="spin" aria-hidden /><span>Running in an isolated Chromium session: step {Math.min(done + 1, run.log.length)} of {run.log.length}.</span></p>}
        {run.status === "recovering" && <p className="callout info" role="status"><Wrench aria-hidden /><span>A step&apos;s target was not found. Opus is investigating the live page; the engine will validate any proposal before it runs.</span></p>}
        {run.status === "needs_approval" && <p className="callout warning" role="status"><ShieldAlert aria-hidden /><span><strong>Your decision is needed.</strong> Review the proposed repair in the Recovery panel. The run is paused and its time limit is on hold.</span></p>}
        {run.status === "succeeded" && (
          <p className="callout success" role="status"><CheckCircle2 aria-hidden />
            <span>All steps completed and {run.checks.length} verification check{run.checks.length === 1 ? "" : "s"} passed{repaired ? `, including ${repaired} repaired step${repaired === 1 ? "" : "s"}` : ""}.</span>
          </p>
        )}
        {(run.status === "failed" || run.status === "cancelled") && (
          <div className={`callout ${run.status === "failed" ? "danger" : "warning"}`} role="alert">
            <XCircle aria-hidden />
            <div style={{ display: "grid", gap: 8 }}>
              <span>{run.error ?? "Run did not complete."}</span>
              {run.status === "failed" && (
                <span className="row">
                  <span className="hint" style={{ color: "inherit" }}>Nothing was guessed. Review the steps or re-plan; the saved workflow never changes automatically.</span>
                  <Link className="btn" href={`/workflows/${run.workflow.id}`}><RefreshCw aria-hidden /> Review / re-plan</Link>
                </span>
              )}
            </div>
          </div>
        )}
        {error && <p className="callout danger"><AlertTriangle aria-hidden />{error}</p>}

        <section className="card">
          <h3>Step timeline</h3>
          <ol className="steps">
            {run.log.map((l) => (
              <li key={l.index} className={l.status}>
                <span className="n">{l.index + 1}</span>
                <div>
                  <div><span className="action">{l.action}</span> <span className="mono">{l.target}</span></div>
                  <div className="muted">{l.description}</div>
                  {l.failures.map((f) => (
                    <div key={f.attempt} className="timeline-attempt">
                      <div className="observed" style={{ color: "var(--danger)" }}>attempt {f.attempt} failed: {f.error}</div>
                      {f.evidence && <Evidence src={art(f.evidence)} alt={`Page when step ${l.index + 1} attempt ${f.attempt} failed`} />}
                    </div>
                  ))}
                  {l.repairedSelector && l.status === "ok" && <div className="observed" style={{ color: "var(--success)" }}>repaired target used: {l.repairedSelector}</div>}
                  {l.observed && l.status === "ok" && <div className="observed">→ {l.observed}</div>}
                  {l.action === "screenshot" && l.evidence && <Evidence src={art(l.evidence)} alt={`Screenshot after step ${l.index + 1}`} />}
                </div>
                <div style={{ display: "grid", justifyItems: "end", alignContent: "start", gap: 2 }}>
                  <StatusTag status={l.status} />
                  {l.attempts > 1 && <span className="hint">{l.attempts} attempts</span>}
                  {l.startedAt && <span className="hint mono">{duration(l.startedAt, l.finishedAt)}</span>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {csv && run.csvFile && (
          <section className="card">
            <div className="spread">
              <h3>Exported CSV · {csv.rows.length} rows</h3>
              <a className="btn primary" href={art(run.csvFile)} download><Download aria-hidden /> Download CSV</a>
            </div>
            <div className="scroll-x">
              <table className="grid">
                <thead><tr>{csv.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{csv.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="mono">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {csv.rows.length === 0 && <p className="muted">The export has headers but no rows for these inputs.</p>}
          </section>
        )}
      </div>

      <aside>
        <section className="card" aria-label="Recovery">
          <h2>Recovery</h2>
          {run.repairs.length === 0 && <p className="muted">No recovery was needed{active ? " so far" : ""}.</p>}
          {run.repairs.map((r) => (
            <div key={r.id} style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="spread"><strong>Step {r.stepIndex + 1} · {r.action}</strong><StatusTag status={r.decision} /></div>
              <div>
                <div className="hint">What failed</div>
                <div className="observed mono" style={{ color: "var(--danger)" }}>{r.error}</div>
                {r.failureEvidence && <Evidence src={art(r.failureEvidence)} alt={`Page at failure of step ${r.stepIndex + 1}`} />}
              </div>
              {r.proposedSelector && (
                <div>
                  <div className="hint">What changed (proposed by Opus)</div>
                  <div className="diff"><span>before</span><span className="old">{r.failedSelector}</span><span>after</span><span className="new">{r.proposedSelector}</span></div>
                  {r.matched && <div className="hint">Matches &lt;{r.matched.tag}&gt; “{r.matched.label}”</div>}
                  <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{r.rationale}{r.confidence && <> · confidence {r.confidence}</>}</p>
                </div>
              )}
              <div>
                <div className="hint">Engine checks</div>
                {r.validation.length ? <ul className="observed" style={{ margin: 0, paddingLeft: 16, color: "var(--danger)" }}>{r.validation.map((v) => <li key={v}>{v}</li>)}</ul>
                  : r.proposedSelector ? <div className="observed" style={{ color: "var(--success)" }}>Same action and value, one visible element of the right kind, non-destructive, permitted origin.</div>
                  : <div className="observed">No proposal to check.</div>}
              </div>
              <div>
                <div className="hint">Why {r.decision === "auto_approved" ? "it was applied automatically" : "this decision"}</div>
                <div style={{ fontSize: 13 }}>{r.decisionReason}</div>
              </div>
              {r.decision === "pending" && run.status === "needs_approval" && pending?.id === r.id && (
                <div className="row">
                  <button className="btn primary" disabled={!!busy} onClick={() => act("approve", () => api(`/api/runs/${id}/repairs/${r.id}`, { body: { decision: "approve" } }))}><Check aria-hidden /> Approve repair</button>
                  <button className="btn" disabled={!!busy} onClick={() => act("reject", () => api(`/api/runs/${id}/repairs/${r.id}`, { body: { decision: "reject" } }))}><X aria-hidden /> Reject</button>
                </div>
              )}
              <div className="spread">
                <span className="hint">Retried step</span>
                <StatusTag status={r.outcome} />
              </div>
              {r.outcomeDetail && <div className="observed">{r.outcomeDetail}</div>}
              {r.outcome === "verified" && <div className="hint">The repaired step ran. The run still has to pass every original check below.</div>}
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Verification</h2>
          {run.checks.length === 0 ? <p className="muted">{active ? "Checks run after the actions they verify." : "No checks were evaluated."}</p> : (
            <ul className="steps">
              {run.checks.map((c, i) => (
                <li key={i} className={c.passed ? "" : "failed"} style={{ gridTemplateColumns: "20px 1fr" }}>
                  {c.passed ? <CheckCircle2 aria-label="passed" style={{ color: "var(--success)", width: 16 }} /> : <XCircle aria-label="failed" style={{ color: "var(--danger)", width: 16 }} />}
                  <div><div>{c.description}</div><div className="observed">{c.detail}</div></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Queued</dt><dd>{when(run.createdAt)}</dd>
            <dt>Duration</dt><dd className="mono">{duration(run.startedAt, run.finishedAt)}</dd>
            {Object.entries(run.inputs).map(([k, v]) => <Fragment key={k}><dt className="mono">{k}</dt><dd className="mono">{v}</dd></Fragment>)}
            <dt>Checkpoints</dt><dd>{run.checkpoints} verified step{run.checkpoints === 1 ? "" : "s"} saved</dd>
            <dt>Model use</dt><dd>{run.usage.modelCalls ? <>{run.usage.modelCalls} calls · ≈ ${run.usage.estimatedCostUsd?.toFixed(3)} <span className="hint">(estimate)</span></> : "none"}</dd>
          </dl>
        </section>

        {!active && (
          <section className="card">
            <h2>Final page</h2>
            {noFinalShot ? <p className="muted">No final screenshot (the browser closed before one was taken).</p> : (
              <a href={art("final.png")} target="_blank" rel="noreferrer"><img className="shot" src={art("final.png")} alt="Final page state" onError={() => setNoFinalShot(true)} /></a>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
