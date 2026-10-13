const LABELS: Record<string, string> = {
  needs_approval: "needs approval", auto_approved: "auto-approved", no_safe_repair: "no safe repair", not_applied: "not applied",
};

export function StatusTag({ status }: { status: string }) {
  return <span className={`tag ${status}`}>{LABELS[status] ?? status}</span>;
}
