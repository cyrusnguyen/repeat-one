import type { Run, Workflow } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./http";
import { InputDef, Step } from "./schemas";
import type { PlanMeta } from "./planner";

export type StepLog = {
  index: number;
  action: string;
  target: string;
  description: string;
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  observed?: string;
  screenshot?: string;
  startedAt?: string;
  finishedAt?: string;
};
export type CheckLog = { step: number; description: string; passed: boolean; detail: string };

/** Persisted JSON columns are re-validated on read so a corrupted definition fails loudly instead of replaying garbage. */
export function parseWorkflow(row: Workflow) {
  return {
    ...row,
    inputs: z.array(InputDef).parse(JSON.parse(row.inputs)),
    steps: z.array(Step).parse(JSON.parse(row.steps)),
    allowedPrefixes: z.array(z.string()).parse(JSON.parse(row.allowedPrefixes)),
    planMeta: JSON.parse(row.planMeta) as Partial<PlanMeta>,
  };
}

export function parseRun(row: Run) {
  return {
    ...row,
    inputs: JSON.parse(row.inputs) as Record<string, string>,
    log: JSON.parse(row.log) as StepLog[],
    checks: JSON.parse(row.checks) as CheckLog[],
  };
}

export async function loadWorkflow(id: string) {
  const row = await db.workflow.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Workflow not found. It may have been deleted.");
  return row;
}
