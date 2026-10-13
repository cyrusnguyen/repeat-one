"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { Table } from "@/lib/checks";
import type { CheckLog, StepLog } from "@/lib/store";
import { StatusPill } from "./StatusPill";

export type Repair = {
  id: string; stepIndex: number; attempt: number; action: string; failedSelector: string; error: string; failureEvidence: string | null;
  proposedSelector: string | null; rationale: string; confidence: string | null; validation: string[]; matched: { tag?: string; label?: string } | null;
  decision: string; decisionReason: string; outcome: string; outcomeDetail: string;
};

type Tab = "Repair" | "Page" | "Checks" | "CSV";

/** Evidence for one step or a folded group of steps: repairs, screenshots, checks, CSV. Shows only what exists. */
export function EvidenceDrawer(props: {
  title: string;
  steps: StepLog[];
  repairs: Repair[];
  checks: CheckLog[];
  csv: Table | null;
  finalShot: string | null;
  art: (name: string) => string;
  decisionOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onDecide: (repairId: string, decision: "approve" | "reject") => void;
}) {
  const { title, steps, repairs, checks, csv, finalShot, art, decisionOpen, busy, onClose, onDecide } = props;
  const indices = new Set(steps.map((s) => s.index));
  const myRepairs = repairs.filter((r) => indices.has(r.stepIndex));
  const myChecks = checks.filter((c) => indices.has(c.step - 1));
  const shots = steps.flatMap((s) => [
    ...s.failures.filter((f) => f.evidence).map((f) => ({ src: f.evidence!, alt: `Page when step ${s.index + 1} attempt ${f.attempt} failed` })),
    ...(s.action === "screenshot" && s.evidence ? [{ src: s.evidence, alt: `Screenshot after step ${s.index + 1}` }] : []),
  ]);
  const showCsv = !!csv && steps.some((s) => s.action === "download" && s.status === "ok");
  const tabs: Tab[] = [...(myRepairs.length ? ["Repair" as const] : []), "Page", ...(myChecks.length ? ["Checks" as const] : []), ...(showCsv ? ["CSV" as const] : [])];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const current = tabs.includes(tab) ? tab : tabs[0];
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="drawer" role="dialog" aria-label="Evidence">
      <header>
        <h2 ref={heading} tabIndex={-1} style={{ fontSize: 15 }}>{title}</h2>
        <button className="btn quiet" onClick={onClose} aria-label="Close evidence"><X aria-hidden /></button>
      </header>
      <div className="tabs" role="tablist">
        {tabs.map((t) => <button key={t} role="tab" aria-selected={t === current} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div className="body" role="tabpanel">
        {current === "Repair" && myRepairs.map((r) => (
          <section key={r.id} className="stack" style={{ gap: 10, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
            <div className="spread"><b>Step {r.stepIndex + 1} · {r.action} · attempt {r.attempt}</b><StatusPill status={r.decision} /></div>
            <div>
              <div className="eyebrow">What failed</div>
              <div className="mono" style={{ color: "var(--bad)" }}>{r.error}</div>
              {r.failureEvidence && <a href={art(r.failureEvidence)} target="_blank" rel="noreferrer"><img className="shot" src={art(r.failureEvidence)} alt={`Page at failure of step ${r.stepIndex + 1}`} style={{ marginTop: 8 }} /></a>}
            </div>
            {r.proposedSelector && (
              <div>
                <div className="eyebrow">What changed (proposed by Opus{r.confidence ? `, ${r.confidence} confidence` : ""})</div>
                <div className="diff"><s>{r.failedSelector}</s> → <ins>{r.proposedSelector}</ins></div>
                {r.matched && <div className="hint">Matches &lt;{r.matched.tag}&gt; “{r.matched.label}”</div>}
                <p className="muted" style={{ marginTop: 6 }}>{r.rationale}</p>
              </div>
            )}
            <div>
              <div className="eyebrow">Engine checks</div>
              {r.validation.length
                ? <ul className="mono" style={{ margin: 0, paddingLeft: 16, color: "var(--bad)" }}>{r.validation.map((v) => <li key={v}>{v}</li>)}</ul>
                : r.proposedSelector
                  ? <div style={{ color: "var(--ok)" }}>Same action and value, one visible element of the right kind, not destructive, permitted page.</div>
                  : <div className="muted">No proposal to check.</div>}
            </div>
            <div>
              <div className="eyebrow">Decision</div>
              <div>{r.decisionReason}</div>
            </div>
            {r.decision === "pending" && decisionOpen && (
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={() => onDecide(r.id, "approve")}><Check aria-hidden /> Approve repair</button>
                <button className="btn" disabled={busy} onClick={() => onDecide(r.id, "reject")}><X aria-hidden /> Reject</button>
              </div>
            )}
            <div className="spread"><span className="eyebrow">Retried step</span><StatusPill status={r.outcome} /></div>
            {r.outcomeDetail && <div className="mono muted">{r.outcomeDetail}</div>}
            {r.outcome === "verified" && <div className="hint">The repaired step ran. The run still had to pass every original check.</div>}
          </section>
        ))}

        {current === "Page" && (
          <>
            {shots.map((s) => (
              <figure key={s.src} style={{ margin: 0 }}>
                <figcaption className="hint" style={{ marginBottom: 6 }}>{s.alt}</figcaption>
                <a href={art(s.src)} target="_blank" rel="noreferrer"><img className="shot" src={art(s.src)} alt={s.alt} /></a>
              </figure>
            ))}
            {!shots.length && <p className="muted">No screenshot was taken at this step. Screenshots are saved at failures, at screenshot steps and at the end of the run.</p>}
            {finalShot && (
              <figure style={{ margin: 0 }}>
                <figcaption className="hint" style={{ marginBottom: 6 }}>Final page (end of run)</figcaption>
                <a href={art(finalShot)} target="_blank" rel="noreferrer"><img className="shot" src={art(finalShot)} alt="Final page state" /></a>
              </figure>
            )}
            {steps.map((s) => s.observed && <div key={s.index} className="mono muted">Step {s.index + 1} → {s.observed}</div>)}
          </>
        )}

        {current === "Checks" && myChecks.map((c, i) => (
          <div key={i} className="card" style={{ padding: "10px 12px", borderColor: c.passed ? "var(--ok-line)" : "var(--bad-line)" }}>
            <div className="spread"><b>{c.description}</b><StatusPill status={c.passed ? "ok" : "failed"} label={c.passed ? "passed" : "failed"} /></div>
            <div className="mono muted" style={{ marginTop: 4 }}>{c.detail}</div>
          </div>
        ))}

        {current === "CSV" && csv && (
          <div className="scroll-x">
            <table className="data">
              <thead><tr>{csv.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{csv.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </aside>
  );
}
