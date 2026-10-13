import { db } from "@/lib/db";
import { handle, HttpError, type Ctx } from "@/lib/http";
import { reconcileRun } from "@/lib/runner";
import { parseRepair, parseRun } from "@/lib/store";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const row = await db.run.findUnique({ where: { id }, include: { workflow: { select: { id: true, name: true, task: true } } } });
  if (!row) throw new HttpError(404, "Run not found.");
  const run = await reconcileRun(row);
  const [repairs, checkpoints] = await Promise.all([
    db.repair.findMany({ where: { runId: id }, orderBy: { createdAt: "asc" } }),
    db.checkpoint.count({ where: { runId: id } }),
  ]);
  return { ...parseRun(run), workflow: row.workflow, repairs: repairs.map(parseRepair), checkpoints };
});
