import type { Repair, Run, Workflow } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./http";
import { InputDef, Step } from "./schemas";
import type { PlanMeta } from "./planner";
import type { Usage } from "./ai";

export type StepLog = {
  index: number;
  action: string;
  target: string;
  description: string;
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  attempts: number;
  observed?: string;
  evidence?: string;
  repairedSelector?: string;
  failures: { attempt: number; error: string; evidence?: string }[];
  startedAt?: string;
  finishedAt?: string;
};
export type CheckLog = { step: number; description: string; passed: boolean; detail: string };

/** What a run executed: a frozen copy of the workflow version, so later edits never change history. */
export const Definition = z.object({
  version: z.number().int(),
  steps: z.array(Step),
  inputs: z.array(InputDef),
  allowedPrefixes: z.array(z.string()),
  recoveryPolicy: z.enum(["auto_safe", "ask"]),
});
export type Definition = z.infer<typeof Definition>;

/** Persisted JSON columns are re-validated on read so a corrupted definition fails loudly instead of replaying garbage. */
export function parseWorkflow(row: Workflow) {
  return {
    ...row,
    inputs: z.array(InputDef).parse(JSON.parse(row.inputs)),
    steps: z.array(Step).parse(JSON.parse(row.steps)),
    allowedPrefixes: z.array(z.string()).parse(JSON.parse(row.allowedPrefixes)),
    recoveryPolicy: z.enum(["auto_safe", "ask"]).parse(row.recoveryPolicy),
    planMeta: JSON.parse(row.planMeta) as Partial<PlanMeta>,
  };
}

export function parseRun(row: Run) {
  return {
    ...row,
    definition: JSON.parse(row.definition) as Definition,
    inputs: JSON.parse(row.inputs) as Record<string, string>,
    log: JSON.parse(row.log) as StepLog[],
    checks: JSON.parse(row.checks) as CheckLog[],
    usage: JSON.parse(row.usage) as Partial<Usage>,
  };
}

export function parseRepair(row: Repair) {
  return {
    ...row,
    validation: JSON.parse(row.validation) as string[],
    matched: row.matched ? (JSON.parse(row.matched) as Record<string, unknown>) : null,
    usage: JSON.parse(row.usage) as Partial<Usage>,
  };
}

export async function loadWorkflow(id: string) {
  const row = await db.workflow.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Workflow not found. It may have been deleted.");
  return row;
}
