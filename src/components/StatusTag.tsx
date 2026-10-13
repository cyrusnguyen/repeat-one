const LABELS: Record<string, string> = { needs_approval: "needs approval" };

export function StatusTag({ status }: { status: string }) {
  return <span className={`tag ${status}`}>{LABELS[status] ?? status}</span>;
}
