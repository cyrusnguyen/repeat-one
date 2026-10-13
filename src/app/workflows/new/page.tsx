"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, Sparkles, X } from "lucide-react";
import { api, notifyWorkflowsChanged } from "@/lib/client";

type InputRow = { name: string; label: string; type: "number" | "text"; default: string };
type Config = { prefixes: string[]; demoUrl: string; hasApiKey: boolean; limits: { maxModelCalls: number; maxPlanCostUsd: number } };

const DEMO_TASK = "Export unpaid invoices above a minimum amount to CSV.";

export default function NewWorkflow() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [name, setName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [task, setTask] = useState("");
  const [inputs, setInputs] = useState<InputRow[]>([]);
  const [recoveryPolicy, setRecoveryPolicy] = useState<"auto_safe" | "ask">("auto_safe");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Config>("/api/config").then((c) => { setConfig(c); setStartUrl((u) => u || c.demoUrl); }, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  const useDemo = () => {
    setName("Unpaid invoices export");
    if (config) setStartUrl(config.demoUrl);
    setTask(DEMO_TASK);
    setInputs([{ name: "minimumAmount", label: "Minimum amount (USD)", type: "number", default: "1000" }]);
  };
  const setInput = (i: number, patch: Partial<InputRow>) => setInputs((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!task.trim()) return setError("Describe the task you want automated.");
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("/api/workflows", { body: { name, startUrl, task, inputs, recoveryPolicy } });
      notifyWorkflowsChanged();
      router.push(`/workflows/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <form className="page" onSubmit={submit} aria-busy={busy}>
        <div className="spread">
          <h1>Create workflow</h1>
          <button type="button" className="btn ghost" onClick={useDemo} disabled={busy}><Sparkles aria-hidden /> Use demo example</button>
        </div>

        {config && !config.hasApiKey && (
          <p className="callout warning"><AlertTriangle aria-hidden /><span>ANTHROPIC_API_KEY is not set on the server, so planning will fail. Add it to <code>.env</code> and restart.</span></p>
        )}

        <div className="card">
          <label className="field">Name <span className="hint">Optional. Opus suggests one if left empty.</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={busy} />
          </label>
          <label className="field">Starting URL
            <input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} required disabled={busy} inputMode="url" />
            <span className="hint">Allowed prefixes: {config?.prefixes.join(", ") ?? "…"}</span>
          </label>
          <label className="field">What should happen?
            <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder={DEMO_TASK} disabled={busy} maxLength={2000} />
          </label>
          <label className="field">When the page changes and a step&apos;s target is missing
            <select value={recoveryPolicy} onChange={(e) => setRecoveryPolicy(e.target.value as "auto_safe" | "ask")} disabled={busy}>
              <option value="auto_safe">Let Opus repair read-only steps automatically; ask me before repairing clicks</option>
              <option value="ask">Always ask me before applying a repair</option>
            </select>
          </label>
        </div>

        <div className="card">
          <div className="spread">
            <h2>Inputs</h2>
            <button type="button" className="btn" disabled={busy || inputs.length >= 10}
              onClick={() => setInputs((r) => [...r, { name: "", label: "", type: "text", default: "" }])}>
              <Plus aria-hidden /> Add input
            </button>
          </div>
          <p className="hint">Values you want to change between runs. Steps refer to them as {"{{name}}"}.</p>
          {inputs.length === 0 && <p className="muted">No inputs. The workflow will run the same way every time.</p>}
          {inputs.map((row, i) => (
            <div key={i} className="row" style={{ alignItems: "end" }}>
              <label className="field" style={{ flex: "1 1 140px" }}>Name
                <input value={row.name} onChange={(e) => setInput(i, { name: e.target.value })} placeholder="minimumAmount" required disabled={busy} />
              </label>
              <label className="field" style={{ flex: "2 1 180px" }}>Label
                <input value={row.label} onChange={(e) => setInput(i, { label: e.target.value })} placeholder="Minimum amount (USD)" required disabled={busy} />
              </label>
              <label className="field" style={{ flex: "0 1 110px" }}>Type
                <select value={row.type} onChange={(e) => setInput(i, { type: e.target.value as InputRow["type"] })} disabled={busy}>
                  <option value="number">number</option>
                  <option value="text">text</option>
                </select>
              </label>
              <label className="field" style={{ flex: "1 1 110px" }}>Default
                <input value={row.default} onChange={(e) => setInput(i, { default: e.target.value })} disabled={busy} />
              </label>
              <button type="button" className="btn ghost" aria-label={`Remove input ${row.name || i + 1}`} disabled={busy}
                onClick={() => setInputs((r) => r.filter((_, j) => j !== i))}><X aria-hidden /></button>
            </div>
          ))}
        </div>

        {error && <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span style={{ whiteSpace: "pre-wrap" }}>{error}</span></p>}

        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? <><Loader2 className="spin" aria-hidden /> Planning… {elapsed}s</> : "Inspect page & propose plan"}
          </button>
          {busy && <span className="muted" role="status">Opus is inspecting the live page and drafting steps. This usually takes under a minute.</span>}
        </div>
      </form>

      <aside>
        <h3>How it works</h3>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>Opus loads the start page in an isolated browser and reads it with read-only tools.</li>
          <li>It proposes ordered steps with checks. Nothing runs yet.</li>
          <li>You review and approve. Only approved plans can run.</li>
          <li>Playwright performs the steps, verifies the result and keeps the evidence.</li>
        </ol>
        <h3>Limits</h3>
        <p className="hint">Up to {config?.limits.maxModelCalls ?? "…"} model calls and an estimated ${config?.limits.maxPlanCostUsd ?? "…"} per plan. Page text is treated as untrusted data.</p>
      </aside>
    </div>
  );
}
