"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

const LABELS: Record<string, string> = { classic: "Classic", redesigned: "Redesigned", export_removed: "Export removed" };

/** Demo-only control that changes the invoice portal's markup to exercise recovery. */
export function DemoVariantToggle() {
  const [variant, setVariant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ variant: string }>("/api/demo/variant").then((r) => setVariant(r.variant), (e: Error) => setError(e.message)); }, []);

  return (
    <div className="row" role="group" aria-label="Demo portal UI variant">
      <span className="hint">Demo portal UI</span>
      <div className="segmented">
        {Object.entries(LABELS).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={variant === value} disabled={variant === null}
            onClick={() => api<{ variant: string }>("/api/demo/variant", { body: { variant: value } }).then((r) => { setVariant(r.variant); setError(null); }, (e: Error) => setError(e.message))}>
            {label}
          </button>
        ))}
      </div>
      {error && <span className="hint" style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}
