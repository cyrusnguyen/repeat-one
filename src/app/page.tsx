"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { api } from "@/lib/client";
import { TopBar } from "@/components/TopBar";
import { StatusPill } from "@/components/StatusPill";

type Item = { id: string; name: string; task: string; version: number; status: string; runCount: number; lastRunStatus: string | null };

/** The one thing a person needs to know about a workflow, in words. */
function outcome(w: Item): { status: string; label: string; action: string } {
  if (w.status === "needs_approval") return { status: "needs_approval", label: "needs approval", action: "Review" };
  if (w.status === "rejected") return { status: "rejected", label: "plan rejected", action: "Open" };
  switch (w.lastRunStatus) {
    case null: return { status: "", label: "not run yet", action: "Open" };
    case "succeeded": return { status: "succeeded", label: "last run verified", action: "Open" };
    case "failed": return { status: "failed", label: "last run failed", action: "Open" };
    case "cancelled": return { status: "cancelled", label: "last run cancelled", action: "Open" };
    default: return { status: "running", label: "running now", action: "Open" };
  }
}

export default function Home() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Item[]>("/api/workflows").then(setItems, (e: Error) => setError(e.message)); }, []);

  return (
    <>
      <TopBar><Link className="btn primary" href="/workflows/new"><Plus aria-hidden /> New workflow</Link></TopBar>
      <main className="page">
        <div>
          <h1 className="h1">Workflows</h1>
          <p className="lead">Saved browser tasks. Each one is a plan you approved, and every run keeps its evidence.</p>
        </div>
        {error && <p className="callout danger" role="alert"><AlertTriangle aria-hidden /><span>{error}</span></p>}
        {items === null && !error && <p className="muted"><Loader2 className="spin" aria-hidden style={{ width: 14, verticalAlign: -2 }} /> Loading…</p>}
        {items?.length === 0 && (
          <div className="card">
            <p><b>No workflows yet.</b></p>
            <p className="muted">Describe a task once and Opus will propose a plan for you to approve. <Link href="/workflows/new">Create your first workflow →</Link></p>
          </div>
        )}
        {!!items?.length && (
          <ul className="list" aria-label="Workflows">
            {items.map((w) => {
              const o = outcome(w);
              return (
                <li key={w.id}>
                  <Link className="list-row" href={`/workflows/${w.id}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">{w.name}</div>
                      <div className="sub">{w.task} · v{w.version} · {w.runCount} run{w.runCount === 1 ? "" : "s"}</div>
                    </div>
                    <StatusPill status={o.status} label={o.label} />
                    <span className="btn" aria-hidden>{o.action} →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
