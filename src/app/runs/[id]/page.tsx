"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Square, XCircle } from "lucide-react";
import { api, duration, when } from "@/lib/client";
import { parseCsv, type Table } from "@/lib/checks";
import { StatusTag } from "@/components/StatusTag";
import type { CheckLog, StepLog } from "@/lib/store";

type RunData = {
  id: string; status: string; error: string | null; csvFile: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  inputs: Record<string, string>; log: StepLog[]; checks: CheckLog[];
  workflow: { id: string; name: string };
};

const ACTIVE = new Set(["queued", "running"]);

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<Table | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [noFinalShot, setNoFinalShot] = useState(false);
  const art = (name: string) => `/api/runs/${id}/artifacts/${name}`;

  const load = useCallback(() => api<RunData>(`/api/runs/${id}`).then(setRun, (e: Error) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const active = run ? ACTIVE.has(run.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [active, load]);

  useEffect(() => {
    if (!run?.csvFile || active) return;
    fetch(art(run.csvFile)).then((r) => (r.ok ? r.text() : Promise.reject(new Error("CSV unavailable")))).then((t) => setCsv(parseCsv(t)), () => setCsv(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.csvFile, active]);

  if (!run) {
    return <div className="page">{error ? <p className="callout danger" role="alert"><AlertTriangle aria-hidden />{error}</p> : <p className="muted"><Loader2 className="spin" aria-hidden /> Loading run…</p>}</div>;
  }
  const done = run.log.filter((l) => l.status === "ok").length;

  return (
    <div className="split">
      <div className="page">
        <div className="spread">
          <div style={{ display: "grid", gap: 4 }}>
            <Link href={`/workflows/${run.workflow.id}`} className="hint">← {run.workflow.name}</Link>
            <div className="row"><h1>Run</h1><StatusTag status={run.status} /><span className="hint mono">{run.id}</span></div>
          </div>
          {active && (
            <button className="btn danger" disabled={cancelling} onClick={() => {
              setCancelling(true);
              api(`/api/runs/${id}/cancel`, { body: {} }).catch((e: Error) => setError(e.message)).finally(load);
            }}><Square aria-hidden /> {cancelling ? "Cancelling…" : "Cancel run"}</button>
          )}
        </div>

        {active && <p className="callout info" role="status"><Loader2 className="spin" aria-hidden /><span>Running in an isolated Chromium session: step {Math.min(done + 1, run.log.length)} of {run.log.length}.</span></p>}
        {run.status === "succeeded" && <p className="callout success" role="status"><CheckCircle2 aria-hidden /><span>All steps completed and {run.checks.length} verification check{run.checks.length === 1 ? "" : "s"} passed.</span></p>}
        {(run.status === "failed" || run.status === "cancelled") && (
          <div className={`callout ${run.status === "failed" ? "danger" : "warning"}`} role="alert">
            <XCircle aria-hidden />
            <div style={{ display: "grid", gap: 8 }}>
              <span>{run.error ?? "Run did not complete."}</span>
              {run.status === "failed" && (
                <span className="row">
                  <span className="hint" style={{ color: "inherit" }}>If the site changed, review the steps or ask Opus to re-plan. The saved workflow is never changed automatically.</span>
                  <Link className="btn" href={`/workflows/${run.workflow.id}`}><RefreshCw aria-hidden /> Review / re-plan</Link>
                </span>
              )}
            </div>
          </div>
        )}
        {error && <p className="callout danger"><AlertTriangle aria-hidden />{error}</p>}

        <section className="card">
          <h3>Steps</h3>
          <ol className="steps">
            {run.log.map((l) => (
              <li key={l.index} className={l.status}>
                <span className="n">{l.index + 1}</span>
                <div>
                  <div><span className="action">{l.action}</span> <span className="mono">{l.target}</span></div>
                  <div className="muted">{l.description}</div>
                  {l.observed && <div className="observed">→ {l.observed}</div>}
                  {l.screenshot && <a href={art(l.screenshot)} target="_blank" rel="noreferrer"><img className="shot" src={art(l.screenshot)} alt={`Screenshot after step ${l.index + 1}`} style={{ marginTop: 8, maxHeight: 260 }} /></a>}
                </div>
                <div style={{ display: "grid", justifyItems: "end", alignContent: "start", gap: 2 }}>
                  <StatusTag status={l.status} />
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
        <section className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Queued</dt><dd>{when(run.createdAt)}</dd>
            <dt>Duration</dt><dd className="mono">{duration(run.startedAt, run.finishedAt)}</dd>
            {Object.entries(run.inputs).map(([k, v]) => <Fragment key={k}><dt className="mono">{k}</dt><dd className="mono">{v}</dd></Fragment>)}
          </dl>
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
