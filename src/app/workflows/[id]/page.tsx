"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Eye, Loader2, Pencil, Play, RefreshCw, Trash2, X } from "lucide-react";
import { api, duration, when } from "@/lib/client";
import { TopBar } from "@/components/TopBar";
import { StatusPill } from "@/components/StatusPill";
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

const KIND: Record<Step["action"], string> = {
  navigate: "read", extract: "read", wait: "read", select: "filter", fill: "filter", click: "click", download: "export", screenshot: "evidence", assert: "check",
};
const KEY_ACTIONS = new Set<Step["action"]>(["navigate", "select", "fill", "click", "download"]);
const RUN_WORDS: Record<string, string> = { succeeded: "verified", failed: "failed", cancelled: "cancelled", needs_approval: "needs approval", recovering: "recovering", running: "running", queued: "queued" };

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [allSteps, setAllSteps] = useState(false);

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
      router.push(`/runs/${runId}`);
    } catch (e) {
      const err = e as Error & { status?: number; data?: { runId?: string } };
      if (err.status === 409 && err.data?.runId) return router.push(`/runs/${err.data.runId}`);
      setError(err.message);
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <>
        <TopBar crumbs={[{ label: "Workflows", href: "/" }, { label: "…" }]} />
        <main className="page">{error ? <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span>{error}</span></p> : <p className="muted"><Loader2 className="spin" aria-hidden style={{ width: 14, verticalAlign: -2 }} /> Loading workflow…</p>}</main>
      </>
    );
  }
  const { workflow: wf, runs, definitionError } = data;
  const meta = wf.planMeta;
  const approved = wf.status === "approved";
  // Run inputs: what the user typed, else the last run's value, else the default.
  const values = Object.fromEntries(wf.inputs.map((i) => [i.name, edits[i.name] ?? runs[0]?.inputs[i.name] ?? i.default]));
  const checks = wf.steps.filter((s) => s.action === "assert");
  const shownSteps = wf.steps.map((s, i) => ({ s, i })).filter(({ s }) => allSteps || KEY_ACTIONS.has(s.action));
  const statusLabel = wf.status === "needs_approval" ? `needs your approval · v${wf.version}` : `${wf.status} · v${wf.version}`;

  return (
    <>
      <TopBar crumbs={[{ label: "Workflows", href: "/" }, { label: wf.name }]} />
      <main className="page">
        <header className="stack" style={{ gap: 8 }}>
          <div><StatusPill status={wf.status} label={statusLabel} /></div>
          {renaming === null ? (
            <div className="row">
              <h1 className="h1">{wf.name}</h1>
              <button className="btn quiet" aria-label="Rename workflow" onClick={() => setRenaming(wf.name)}><Pencil aria-hidden /></button>
            </div>
          ) : (
            <form className="row" onSubmit={(e) => { e.preventDefault(); void act("rename", () => api(`/api/workflows/${id}`, { method: "PATCH", body: { name: renaming } })).then(() => setRenaming(null)); }}>
              <input aria-label="Workflow name" value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={80} autoFocus style={{ maxWidth: 360 }} />
              <button className="btn" type="submit" disabled={!!busy}>Save</button>
              <button className="btn quiet" type="button" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          )}
          <p className="lead">“{wf.task}”</p>
          {meta.modelCalls !== undefined && (
            <p className="hint">Opus read the live page and proposed {wf.steps.length} steps in {meta.modelCalls} model call{meta.modelCalls === 1 ? "" : "s"} (≈ ${meta.estimatedCostUsd?.toFixed(3)}, estimate).</p>
          )}
        </header>

        {error && <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span style={{ whiteSpace: "pre-wrap" }}>{error}</span></p>}
        {definitionError && <p className="callout danger"><AlertTriangle aria-hidden /><span>{definitionError} Use Re-plan.</span></p>}

        {wf.status === "needs_approval" && (
          <section className="card gold spread" aria-label="Approval">
            <div style={{ flex: "1 1 320px" }}>
              <b>Approve this plan to run it.</b>{" "}
              <span className="muted">Nothing has run yet. Preview shows each target on the live page without clicking or typing.</span>
            </div>
            <div className="row">
              <button className="btn" disabled={!!busy} onClick={() => act("preview", async () => setPreview((await api<{ items: PreviewItem[] }>(`/api/workflows/${id}/preview`, { body: {} })).items))}>
                {busy === "preview" ? <Loader2 className="spin" aria-hidden /> : <Eye aria-hidden />} {busy === "preview" ? "Previewing…" : "Preview"}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => act("reject", () => api(`/api/workflows/${id}/approval`, { body: { decision: "reject" } }))}><X aria-hidden /> Reject</button>
              <button className="btn primary" disabled={!!busy || !!definitionError} onClick={() => act("approve", () => api(`/api/workflows/${id}/approval`, { body: { decision: "approve" } }))}><Check aria-hidden /> Approve plan</button>
            </div>
          </section>
        )}

        {wf.status === "rejected" && (
          <p className="callout danger"><X aria-hidden /><span>Plan rejected. It will not run. Re-plan to get a new proposal.</span></p>
        )}

        {approved && (
          <form className="card spread" aria-label="Run" onSubmit={(e) => { e.preventDefault(); void run(values); }}>
            <div className="row" style={{ flex: "1 1 320px", alignItems: "end" }}>
              {wf.inputs.map((i) => (
                <label key={i.name} className="field" style={{ flex: "1 1 160px" }}><span>{i.label}</span>
                  <input name={i.name} className="mono" value={values[i.name] ?? ""} inputMode={i.type === "number" ? "decimal" : undefined}
                    onChange={(e) => setEdits((v) => ({ ...v, [i.name]: e.target.value }))} disabled={busy === "run"} />
                </label>
              ))}
              {!wf.inputs.length && <span className="muted">This workflow has no inputs.</span>}
            </div>
            <div className="row">
              {activeRun && <Link href={`/runs/${activeRun.id}`}>View live run →</Link>}
              <button className="btn primary" type="submit" disabled={!!busy || !!activeRun || !!definitionError}>
                {busy === "run" ? <Loader2 className="spin" aria-hidden /> : <Play aria-hidden />} {activeRun ? "Run in progress" : runs.length ? "Run again" : "Run workflow"}
              </button>
            </div>
          </form>
        )}

        {busy === "replan" && <p className="callout info" role="status"><Loader2 className="spin" aria-hidden /><span>Opus is re-reading the page. The new plan will need approval.</span></p>}

        {preview && (
          <section className="card" aria-label="Preview">
            <div className="spread">
              <h2 className="eyebrow">Preview on the live page</h2>
              <button className="btn quiet" onClick={() => setPreview(null)}><X aria-hidden /> Close</button>
            </div>
            <p className="hint" style={{ margin: "6px 0 4px" }}>Read-only: the start page was loaded in an isolated browser and each target was located. Nothing was clicked, typed or downloaded, so later steps are checked against the start page only.</p>
            <ol className="plan-steps">
              {preview.map((p) => (
                <li key={p.step}>
                  <span className="n">{p.step}</span>
                  <div style={{ minWidth: 0 }}>
                    <div><span className="mono" style={{ color: "var(--gold)" }}>{p.action}</span> <span className="mono">{p.target}</span></div>
                    <div className="hint">{p.detail}</div>
                    {p.image && <img className="shot" src={p.image} alt={`Preview of step ${p.step}`} style={{ marginTop: 8, maxHeight: 220 }} />}
                  </div>
                  <StatusPill status={p.status} />
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="grid-2">
          <section className="card">
            <h2 className="eyebrow">Success means</h2>
            <p className="hint" style={{ margin: "4px 0 10px" }}>A run succeeds only if all of these pass on real page and CSV data.</p>
            <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
              {checks.map((s, i) => <li key={i}>{s.description} <span className="mono muted">({stepTarget(s)})</span></li>)}
            </ul>
          </section>
          <section className="card stack" style={{ gap: 10 }}>
            <h2 className="eyebrow">Inputs & safety</h2>
            {wf.inputs.length ? wf.inputs.map((i) => <div key={i.name}><span className="mono" style={{ color: "var(--gold)" }}>{i.name}</span> <span className="muted">{i.type}, default {i.default || "empty"}</span></div>) : <div className="muted">No inputs.</div>}
            <div className="muted">Only <span className="mono">{wf.allowedPrefixes.join(", ")}</span> can load.</div>
            <label className="field"><span>When a step&apos;s target disappears</span>
              <select aria-label="Recovery policy" value={wf.recoveryPolicy} disabled={!!busy || !!activeRun}
                onChange={(e) => act("policy", () => api(`/api/workflows/${id}`, { method: "PATCH", body: { recoveryPolicy: e.target.value } }))}>
                <option value="auto_safe">Repair read-only steps automatically, ask before clicks</option>
                <option value="ask">Always ask before applying a repair</option>
              </select>
            </label>
          </section>
        </div>

        <section className="card">
          <div className="spread">
            <h2 className="eyebrow">Steps</h2>
            <button className="btn quiet" onClick={() => setAllSteps((v) => !v)}>{allSteps ? "Show key steps" : `Show all ${wf.steps.length} steps`}</button>
          </div>
          <ol className="plan-steps" style={{ marginTop: 6 }}>
            {shownSteps.map(({ s, i }) => (
              <li key={i}>
                <span className="n">{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div>{s.description}</div>
                  <div className="mono muted" style={{ overflowWrap: "anywhere" }}>{s.action} {stepTarget(s)}</div>
                </div>
                <span className="kind">{KIND[s.action]}</span>
              </li>
            ))}
          </ol>
          {wf.planNotes && <p className="hint" style={{ marginTop: 10 }}><b>Planner notes:</b> {wf.planNotes}</p>}
          {!!meta.warnings?.length && <ul className="callout warning" style={{ display: "block", margin: "10px 0 0", paddingLeft: 28 }}>{meta.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {!!meta.trace?.length && (
            <details style={{ marginTop: 10 }}>
              <summary>What Opus looked at ({meta.trace.length} tool calls)</summary>
              <ol className="mono muted" style={{ margin: "8px 0 0", paddingLeft: 20 }}>{meta.trace.map((t, i) => <li key={i}>{t}</li>)}</ol>
            </details>
          )}
        </section>

        <section className="stack" style={{ gap: 10 }}>
          <h2 className="eyebrow">Recent runs</h2>
          {runs.length === 0 ? <p className="muted">No runs yet.</p> : (
            <ul className="list" aria-label="Recent runs">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link className="list-row" href={`/runs/${r.id}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">{when(r.createdAt)}</div>
                      <div className="sub mono">{Object.entries(r.inputs).map(([k, v]) => `${k}=${v}`).join(" ") || "no inputs"} · {duration(r.startedAt, r.finishedAt)}</div>
                    </div>
                    <StatusPill status={r.status} label={RUN_WORDS[r.status] ?? r.status} />
                    <span className="btn" aria-hidden>Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="row" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <button className="btn" disabled={!!busy || !!activeRun} onClick={() => act("replan", () => api(`/api/workflows/${id}/plan`, { body: {} }))}>
            {busy === "replan" ? <Loader2 className="spin" aria-hidden /> : <RefreshCw aria-hidden />} {busy === "replan" ? "Re-planning…" : "Re-plan"}
          </button>
          <button className="btn danger" disabled={!!busy || !!activeRun} onClick={() => {
            if (confirm(`Delete "${wf.name}" and all ${runs.length} run(s) with their evidence? This cannot be undone.`)) {
              void act("delete", async () => { await api(`/api/workflows/${id}`, { method: "DELETE" }); router.push("/"); });
            }
          }}><Trash2 aria-hidden /> Delete</button>
        </footer>
      </main>
    </>
  );
}
