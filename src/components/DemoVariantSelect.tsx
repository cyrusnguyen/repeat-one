"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

const LABELS: Record<string, string> = { classic: "Classic", redesigned: "Redesigned", export_removed: "Export removed" };

/** Demo-only: switches the invoice portal's markup to exercise recovery. */
export function DemoVariantSelect() {
  const [variant, setVariant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ variant: string }>("/api/demo/variant").then((r) => setVariant(r.variant), (e: Error) => setError(e.message)); }, []);

  return (
    <label className="variant" title={error ?? "Demo only: changes the invoice portal's UI"}>
      Demo portal
      <select aria-label="Demo portal UI variant" value={variant ?? ""} disabled={variant === null}
        onChange={(e) => api<{ variant: string }>("/api/demo/variant", { body: { variant: e.target.value } }).then((r) => setVariant(r.variant), (err: Error) => setError(err.message))}>
        {variant === null && <option value="">…</option>}
        {Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
