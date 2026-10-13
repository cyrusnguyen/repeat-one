export const RUN_STATUSES = ["queued", "running", "recovering", "needs_approval", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const NEXT: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["recovering", "succeeded", "failed", "cancelled"],
  recovering: ["running", "needs_approval", "failed", "cancelled"],
  needs_approval: ["running", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const isTerminal = (s: RunStatus) => NEXT[s].length === 0;
export const isActive = (s: string) => s === "queued" || s === "running" || s === "recovering" || s === "needs_approval";

export class IllegalTransition extends Error {
  constructor(from: string, to: string) { super(`Illegal run transition ${from} -> ${to}`); }
}

export function assertTransition(from: string, to: RunStatus): void {
  if (!(RUN_STATUSES as readonly string[]).includes(from) || !NEXT[from as RunStatus].includes(to)) throw new IllegalTransition(from, to);
}
