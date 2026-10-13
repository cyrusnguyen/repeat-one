"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, Sparkles, X } from "lucide-react";
import { api } from "@/lib/client";
import { TopBar } from "@/components/TopBar";

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

  const fillDemo = () => {
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
      router.push(`/workflows/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar crumbs={[{ label: "Workflows", href: "/" }, { label: "New" }]} />
      <form className="page narrow" onSubmit={submit} aria-busy={busy}>
        <div className="spread">
          <div>
            <h1 className="h1">Describe a task once</h1>
            <p className="lead">Opus reads the real page and proposes steps with checks. Nothing runs until you approve.</p>
          </div>
          <button type="button" className="btn" onClick={fillDemo} disabled={busy || !config}><Sparkles aria-hidden /> Fill demo example</button>
        </div>

        {config && !config.hasApiKey && (
          <p className="callout warning"><AlertTriangle aria-hidden /><span>ANTHROPIC_API_KEY is not set on the server, so planning will fail. Add it to <code>.env</code> and restart.</span></p>
        )}

        <label className="field"><span>What should happen?</span>
          <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder={DEMO_TASK} disabled={busy} maxLength={2000} />
        </label>

        <label className="field"><span>Start page</span>
          <input className="mono" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} required disabled={busy} inputMode="url" aria-label="Starting URL" />
          <span className="hint">Allowed: {config?.prefixes.join(", ") ?? "…"}</span>
        </label>

        <div className="stack" style={{ gap: 10 }}>
          <div className="spread">
            <span className="muted" style={{ fontSize: 12.5 }}>Inputs you can change between runs (steps use them as <code>{"{{name}}"}</code>)</span>
            <button type="button" className="btn quiet" disabled={busy || inputs.length >= 10}
              onClick={() => setInputs((r) => [...r, { name: "", label: "", type: "text", default: "" }])}><Plus aria-hidden /> Add input</button>
          </div>
          {inputs.map((row, i) => (
            <div key={i} className="row" style={{ alignItems: "end" }}>
              <label className="field" style={{ flex: "1 1 140px" }}><span>Name</span>
                <input className="mono" value={row.name} onChange={(e) => setInput(i, { name: e.target.value })} placeholder="minimumAmount" required disabled={busy} />
              </label>
              <label className="field" style={{ flex: "2 1 180px" }}><span>Label</span>
                <input value={row.label} onChange={(e) => setInput(i, { label: e.target.value })} placeholder="Minimum amount (USD)" required disabled={busy} />
              </label>
              <label className="field" style={{ flex: "0 1 110px" }}><span>Type</span>
                <select value={row.type} onChange={(e) => setInput(i, { type: e.target.value as InputRow["type"] })} disabled={busy}>
                  <option value="number">number</option>
                  <option value="text">text</option>
                </select>
              </label>
              <label className="field" style={{ flex: "1 1 100px" }}><span>Default</span>
                <input className="mono" value={row.default} onChange={(e) => setInput(i, { default: e.target.value })} disabled={busy} />
              </label>
              <button type="button" className="btn quiet" aria-label={`Remove input ${row.name || i + 1}`} disabled={busy}
                onClick={() => setInputs((r) => r.filter((_, j) => j !== i))}><X aria-hidden /></button>
            </div>
          ))}
        </div>

        <details>
          <summary>Advanced: name and recovery policy</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field"><span>Name (Opus suggests one if empty)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={busy} />
            </label>
            <label className="field"><span>When a step&apos;s target disappears</span>
              <select value={recoveryPolicy} onChange={(e) => setRecoveryPolicy(e.target.value as "auto_safe" | "ask")} disabled={busy}>
                <option value="auto_safe">Repair read-only steps automatically; ask me before repairing clicks</option>
                <option value="ask">Always ask me before applying a repair</option>
              </select>
            </label>
          </div>
        </details>

        {error && <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span style={{ whiteSpace: "pre-wrap" }}>{error}</span></p>}

        <div className="row">
          {/* Disabled until hydrated and configured: an early click would otherwise do a native form submit and silently reload. */}
          <button className="btn primary" type="submit" disabled={busy || !config}>
            {busy ? <><Loader2 className="spin" aria-hidden /> Planning… {elapsed}s</> : "Propose a plan"}
          </button>
          <span className="hint" role={busy ? "status" : undefined}>
            {busy ? "Opus is reading the live page and drafting steps." : `Usually under a minute · limit ${config?.limits.maxModelCalls ?? "…"} model calls / $${config?.limits.maxPlanCostUsd ?? "…"}`}
          </span>
        </div>
      </form>
    </>
  );
}
