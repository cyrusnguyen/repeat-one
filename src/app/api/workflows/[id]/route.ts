import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, readJson, type Ctx } from "@/lib/http";
import { ARTIFACT_ROOT, reconcileRun } from "@/lib/runner";
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
    workflow = { ...row, inputs: [], steps: [], allowedPrefixes: [], planMeta: {} };
  }
  return { workflow, definitionError, runs: await Promise.all(runs.map(async (r) => parseRun(await reconcileRun(r)))) };
});

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { name } = z.object({ name: z.string().trim().min(1, "Name cannot be empty").max(80) }).parse(await readJson(req));
  await loadWorkflow(id);
  await db.workflow.update({ where: { id }, data: { name } });
  return { ok: true };
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await loadWorkflow(id);
  const runs = await Promise.all((await db.run.findMany({ where: { workflowId: id }, select: { id: true, status: true } })).map(reconcileRun));
  if (runs.some((r) => r.status === "running" || r.status === "queued")) throw new HttpError(409, "Cancel the active run before deleting this workflow.");
  await db.workflow.delete({ where: { id } });
  await Promise.all(runs.map((r) => rm(path.join(ARTIFACT_ROOT, r.id), { recursive: true, force: true })));
  return { ok: true };
});
