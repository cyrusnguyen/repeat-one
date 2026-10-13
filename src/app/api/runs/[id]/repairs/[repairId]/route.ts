import { z } from "zod";
import { handle, HttpError, readJson, type Ctx } from "@/lib/http";
import { decideRepairManually, StaleDecision } from "@/lib/runner";

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string; repairId: string }>) => {
  const { id, repairId } = await params;
  const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(await readJson(req));
  try {
    await decideRepairManually(id, repairId, decision === "approve" ? "approved" : "rejected");
  } catch (err) {
    if (err instanceof StaleDecision) throw new HttpError(409, err.message);
    throw err;
  }
  return { ok: true };
});
