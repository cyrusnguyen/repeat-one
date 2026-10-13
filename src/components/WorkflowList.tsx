"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/client";
import { StatusTag } from "./StatusTag";

type Item = { id: string; name: string; status: string; lastRunStatus: string | null };

export function WorkflowList() {
  const pathname = usePathname();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api<Item[]>("/api/workflows").then(setItems, (e: Error) => setError(e.message));
    load();
    window.addEventListener("workflows-changed", load);
    return () => window.removeEventListener("workflows-changed", load);
  }, [pathname]);

  return (
    <>
      <div className="spread">
        <h3>Workflows</h3>
        <Link className="btn" href="/workflows/new"><Plus aria-hidden /> New</Link>
      </div>
      {error && <p className="callout danger">{error}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted hint">No saved workflows yet. Create one to get started.</p>}
      <ul className="wf-list">
        {items?.map((w) => (
          <li key={w.id}>
            <Link href={`/workflows/${w.id}`} aria-current={pathname === `/workflows/${w.id}` ? "page" : undefined}>
              <span className="name">{w.name}</span>
              <StatusTag status={w.status === "approved" ? (w.lastRunStatus ?? "approved") : w.status} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
