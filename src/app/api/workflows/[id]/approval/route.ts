import { z } from "zod";
import { db } from "@/lib/db";
import { handle, HttpError, readJson, type Ctx } from "@/lib/http";
import { loadWorkflow, parseWorkflow } from "@/lib/store";

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(await readJson(req));
  const row = await loadWorkflow(id);
  if (decision === "approve") {
    try {
      parseWorkflow(row);
    } catch {
      throw new HttpError(400, "This plan's saved definition is invalid; re-plan before approving.");
    }
  }
  await db.workflow.update({ where: { id }, data: { status: decision === "approve" ? "approved" : "rejected" } });
  return { ok: true };
});
