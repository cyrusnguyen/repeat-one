"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Eye, Loader2, Pencil, Play, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { api, duration, notifyWorkflowsChanged, when } from "@/lib/client";
import { StatusTag } from "@/components/StatusTag";
import { isActive } from "@/lib/state";
import { stepTarget, type InputDef, type Step } from "@/lib/schemas";
import type { PlanMeta } from "@/lib/planner";
import type { PreviewItem } from "@/lib/preview";

type RunRow = { id: string; status: string; createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null; inputs: Record<string, string> };
type Data = {
  workflow: { id: string; name: string; task: string; startUrl: string; status: string; version: number; recoveryPolicy: "auto_safe" | "ask"; allowedPrefixes: string[]; inputs: InputDef[]; steps: Step[]; planNotes: string; planMeta: Partial<PlanMeta>; updatedAt: string };
  definitionError: string | null;
  runs: RunRow[];
};

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(() => api<Data>(`/api/workflows/${id}`).then((d) => { setData(d); setError(null); }, (e: Error) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);


  const activeRun = data?.runs.find((r) => isActive(r.status));
  useEffect(() => {
    if (!activeRun) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [activeRun, load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
      notifyWorkflowsChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run(values: Record<string, string>) {
    if (busy) return;
    setBusy("run");
    setError(null);
    try {
      const { runId } = await api<{ runId: string }>(`/api/workflows/${id}/runs`, { body: { inputs: values } });
      notifyWorkflowsChanged();
      router.push(`/runs/${runId}`);
    } catch (e) {
      const err = e as Error & { status?: number; data?: { runId?: string } };
      if (err.status === 409 && err.data?.runId) return router.push(`/runs/${err.data.runId}`);
      setError(err.message);
      setBusy(null);
    }
  }

  if (!data) {
    return <div className="page">{error ? <p className="callout danger" role="alert"><AlertTriangle aria-hidden />{error}</p> : <p className="muted"><Loader2 className="spin" aria-hidden /> Loading workflow…</p>}</div>;
  }
  const { workflow: wf, runs, definitionError } = data;
  const meta = wf.planMeta;
  const approved = wf.status === "approved";
  // Run inputs: what the user typed, else the last run's value, else the default.
  const values = Object.fromEntries(wf.inputs.map((i) => [i.name, edits[i.name] ?? runs[0]?.inputs[i.name] ?? i.default]));

  return (
    <div className="split">
      <div className="page">
        <div className="spread">
          {renaming === null ? (
            <div className="row">
              <h1>{wf.name}</h1>
              <span className="hint mono">v{wf.version}</span>
              <StatusTag status={wf.status} />
              <button className="btn ghost" aria-label="Rename workflow" onClick={() => setRenaming(wf.name)}><Pencil aria-hidden /></button>
            </div>
          ) : (
            <form className="row" onSubmit={(e) => { e.preventDefault(); void act("rename", () => api(`/api/workflows/${id}`, { method: "PATCH", body: { name: renaming } })).then(() => setRenaming(null)); }}>
              <input aria-label="Workflow name" value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={80} autoFocus style={{ width: 280 }} />
              <button className="btn primary" type="submit" disabled={!!busy}>Save</button>
              <button className="btn ghost" type="button" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          )}
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={() => act("preview", async () => setPreview((await api<{ items: PreviewItem[] }>(`/api/workflows/${id}/preview`, { body: {} })).items))}>
              {busy === "preview" ? <Loader2 className="spin" aria-hidden /> : <Eye aria-hidden />} {busy === "preview" ? "Previewing…" : "Preview"}
            </button>
            <button className="btn" disabled={!!busy || !!activeRun} onClick={() => act("replan", () => api(`/api/workflows/${id}/plan`, { body: {} }))}>
              {busy === "replan" ? <Loader2 className="spin" aria-hidden /> : <RefreshCw aria-hidden />} {busy === "replan" ? "Re-planning…" : "Re-plan"}
            </button>
            <button className="btn danger" disabled={!!busy || !!activeRun} onClick={() => {
              if (confirm(`Delete "${wf.name}" and all ${runs.length} run(s) with their evidence? This cannot be undone.`)) {
                void act("delete", async () => { await api(`/api/workflows/${id}`, { method: "DELETE" }); router.push("/"); });
              }
            }}><Trash2 aria-hidden /> Delete</button>
          </div>
        </div>

        {error && <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span style={{ whiteSpace: "pre-wrap" }}>{error}</span></p>}
        {definitionError && <p className="callout danger"><AlertTriangle aria-hidden /><span>{definitionError} Use Re-plan.</span></p>}

        {wf.status === "needs_approval" && (
          <div className="callout warning" role="region" aria-label="Approval required">
            <ShieldCheck aria-hidden />
            <div style={{ display: "grid", gap: 8, flex: 1 }}>
              <span><strong>Approval required.</strong> Review the steps below. Nothing runs until you approve this plan. Use <strong>Preview</strong> to see each step&apos;s target highlighted on the live page first; it never clicks or types.</span>
              <div className="row">
                <button className="btn primary" disabled={!!busy || !!definitionError} onClick={() => act("approve", () => api(`/api/workflows/${id}/approval`, { body: { decision: "approve" } }))}><Check aria-hidden /> Approve plan</button>
                <button className="btn" disabled={!!busy} onClick={() => act("reject", () => api(`/api/workflows/${id}/approval`, { body: { decision: "reject" } }))}><X aria-hidden /> Reject</button>
              </div>
            </div>
          </div>
        )}
        {wf.status === "rejected" && <p className="callout danger"><X aria-hidden /><span>Plan rejected. It will not run. Re-plan to get a new proposal.</span></p>}
        {busy === "replan" && <p className="callout info" role="status"><Loader2 className="spin" aria-hidden /><span>Opus is re-inspecting the page. The new plan will need approval.</span></p>}

        <section className="card">
          <h3>Task</h3>
          <p>{wf.task}</p>
          <dl className="kv">
            <dt>Start URL</dt><dd className="mono">{wf.startUrl}</dd>
            <dt>Permitted</dt><dd className="mono">{wf.allowedPrefixes.join(", ")}</dd>
            <dt>Inputs</dt><dd>{wf.inputs.length ? wf.inputs.map((i) => <span key={i.name} className="mono">{`{{${i.name}}}`} <span className="muted">{i.label} ({i.type})</span>{" "}</span>) : <span className="muted">none</span>}</dd>
            <dt>Recovery</dt>
            <dd>
              <select aria-label="Recovery policy" value={wf.recoveryPolicy} disabled={!!busy || !!activeRun} style={{ width: "auto" }}
                onChange={(e) => act("policy", () => api(`/api/workflows/${id}`, { method: "PATCH", body: { recoveryPolicy: e.target.value } }))}>
                <option value="auto_safe">Auto-repair read-only steps, ask before click repairs</option>
                <option value="ask">Always ask before applying a repair</option>
              </select>
            </dd>
            {meta.modelCalls !== undefined && <><dt>Planning</dt><dd>{meta.modelCalls} model calls · {meta.inputTokens?.toLocaleString()} in / {meta.outputTokens?.toLocaleString()} out tokens · ≈ ${meta.estimatedCostUsd?.toFixed(3)} <span className="hint">(estimate from list price)</span></dd></>}
          </dl>
          {wf.planNotes && <p className="muted"><strong>Planner notes:</strong> {wf.planNotes}</p>}
          {!!meta.warnings?.length && <ul className="callout warning" style={{ display: "block", margin: 0, paddingLeft: 28 }}>{meta.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </section>

        {preview && (
          <section className="card" aria-label="Preview">
            <div className="spread">
              <h3>Preview on the live page</h3>
              <button className="btn ghost" onClick={() => setPreview(null)}><X aria-hidden /> Close</button>
            </div>
            <p className="hint">Read-only: the start page was loaded in an isolated browser and each target was located. Nothing was clicked, typed or downloaded, so later steps are checked against the start page only.</p>
            <ol className="steps">
              {preview.map((p) => (
                <li key={p.step}>
                  <span className="n">{p.step}</span>
                  <div>
                    <div><span className="action">{p.action}</span> <span className="mono">{p.target}</span></div>
                    <div className="observed">{p.detail}</div>
                    {p.image && <img className="shot" src={p.image} alt={`Preview of step ${p.step}`} style={{ marginTop: 6, maxHeight: 220 }} />}
                  </div>
                  <StatusTag status={p.status} />
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="card">
          <h3>Success means</h3>
          <p className="hint">A run only succeeds if every one of these checks passes on real page and CSV data. Clicks and model claims never count.</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {wf.steps.filter((s) => s.action === "assert").map((s, i) => <li key={i}>{s.description} <span className="mono muted">({stepTarget(s)})</span></li>)}
          </ul>
        </section>

        <section className="card">
          <h3>Steps ({wf.steps.length})</h3>
          <ol className="steps">
            {wf.steps.map((s, i) => (
              <li key={i}>
                <span className="n">{i + 1}</span>
                <div>
                  <div><span className="action">{s.action}</span> <span className="mono">{stepTarget(s)}</span></div>
                  <div className="muted">{s.description}</div>
                </div>
                <span />
              </li>
            ))}
          </ol>
          {!!meta.trace?.length && (
            <details>
              <summary className="muted">What Opus looked at ({meta.trace.length} tool calls)</summary>
              <ol className="mono muted" style={{ margin: "8px 0 0", paddingLeft: 20 }}>{meta.trace.map((t, i) => <li key={i}>{t}</li>)}</ol>
            </details>
          )}
        </section>
      </div>

      <aside>
        <section className="card">
          <h2>{runs.length ? "Run again" : "Run"}</h2>
          {!approved && <p className="hint">Approve the plan to enable runs.</p>}
          <form onSubmit={(e) => { e.preventDefault(); void run(values); }} style={{ display: "grid", gap: 10 }}>
            {wf.inputs.map((i) => (
              <label key={i.name} className="field">{i.label}
                <input name={i.name} value={values[i.name] ?? ""} inputMode={i.type === "number" ? "decimal" : undefined}
                  onChange={(e) => setEdits((v) => ({ ...v, [i.name]: e.target.value }))} disabled={!approved || busy === "run"} />
              </label>
            ))}
            <button className="btn primary" type="submit" disabled={!approved || !!busy || !!activeRun || !!definitionError}>
              {busy === "run" ? <Loader2 className="spin" aria-hidden /> : <Play aria-hidden />} {activeRun ? "Run in progress" : runs.length ? "Run again" : "Run workflow"}
            </button>
          </form>
          {activeRun && <Link href={`/runs/${activeRun.id}`}>View live progress →</Link>}
        </section>

        <section className="card">
          <h2>Run history</h2>
          {runs.length === 0 ? <p className="muted">No runs yet.</p> : (
            <div className="scroll-x"><table className="grid">
              <thead><tr><th>Started</th><th>Outcome</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/runs/${r.id}`}>{when(r.createdAt)}</Link><div className="hint mono">{Object.entries(r.inputs).map(([k, v]) => `${k}=${v}`).join(" ")}</div></td>
                    <td><StatusTag status={r.status} /><div className="hint mono nowrap">{duration(r.startedAt, r.finishedAt)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </aside>
    </div>
  );
}
