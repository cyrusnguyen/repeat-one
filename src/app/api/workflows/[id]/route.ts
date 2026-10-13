import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, readJson, type Ctx } from "@/lib/http";
import { ARTIFACT_ROOT, reconcileRun } from "@/lib/runner";
import { isActive } from "@/lib/state";
import { loadWorkflow, parseRun, parseWorkflow } from "@/lib/store";

type P = Ctx<{ id: string }>;

export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const row = await loadWorkflow(id);
  const runs = await db.run.findMany({ where: { workflowId: id }, orderBy: { createdAt: "desc" } });
  let workflow;
  let definitionError: string | null = null;
  try {
    workflow = parseWorkflow(row);
  } catch (err) {
    definitionError = `Saved definition is invalid and cannot be replayed safely: ${err instanceof Error ? err.message : String(err)}`;
    workflow = { ...row, inputs: [], steps: [], allowedPrefixes: [], recoveryPolicy: "ask" as const, planMeta: {} };
  }
  return { workflow, definitionError, runs: await Promise.all(runs.map(async (r) => parseRun(await reconcileRun(r)))) };
});

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = z.object({
    name: z.string().trim().min(1, "Name cannot be empty").max(80).optional(),
    recoveryPolicy: z.enum(["auto_safe", "ask"]).optional(),
  }).parse(await readJson(req));
  const row = await loadWorkflow(id);
  const policyChanged = body.recoveryPolicy !== undefined && body.recoveryPolicy !== row.recoveryPolicy;
  await db.workflow.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      // The policy is part of the definition: a change is a new version, and loosening it needs fresh approval.
      ...(policyChanged ? { recoveryPolicy: body.recoveryPolicy, version: { increment: 1 }, ...(body.recoveryPolicy === "auto_safe" && row.status === "approved" ? { status: "needs_approval" } : {}) } : {}),
    },
  });
  return { ok: true };
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await loadWorkflow(id);
  const runs = await Promise.all((await db.run.findMany({ where: { workflowId: id }, select: { id: true, status: true } })).map(reconcileRun));
  if (runs.some((r) => isActive(r.status))) throw new HttpError(409, "Cancel the active run before deleting this workflow.");
  await db.workflow.delete({ where: { id } });
  await Promise.all(runs.map((r) => rm(path.join(ARTIFACT_ROOT, r.id), { recursive: true, force: true })));
  return { ok: true };
});
