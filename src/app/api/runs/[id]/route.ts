import { db } from "@/lib/db";
import { handle, HttpError, type Ctx } from "@/lib/http";
import { reconcileRun } from "@/lib/runner";
import { parseRun } from "@/lib/store";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const row = await db.run.findUnique({ where: { id }, include: { workflow: { select: { id: true, name: true } } } });
  if (!row) throw new HttpError(404, "Run not found.");
  return parseRun(await reconcileRun(row));
});
