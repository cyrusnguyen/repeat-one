const LABELS: Record<string, string> = {
  needs_approval: "needs approval", auto_approved: "auto-repaired", no_safe_repair: "no safe repair", not_applied: "not applied", not_checked: "at run time",
};
const OK = new Set(["succeeded", "approved", "ok", "auto_approved", "verified", "found", "loaded"]);
const BAD = new Set(["failed", "rejected", "invalid", "no_safe_repair", "error", "expired", "ambiguous"]);
const GOLD = new Set(["needs_approval", "pending", "recovering", "running", "queued", "missing"]);

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = OK.has(status) ? "ok" : BAD.has(status) ? "bad" : GOLD.has(status) ? "gold" : "";
  return <span className={`pill ${tone} ${status}`}>{label ?? LABELS[status] ?? status}</span>;
}
