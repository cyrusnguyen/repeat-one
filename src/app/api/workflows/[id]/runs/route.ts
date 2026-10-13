import { z } from "zod";
import { handle, HttpError, readJson, type Ctx } from "@/lib/http";
import { RunConflict, startRun } from "@/lib/runner";

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const { inputs } = z.object({ inputs: z.record(z.string(), z.union([z.string(), z.number()])).default({}) }).parse(await readJson(req));
  try {
    return { runId: await startRun(id, inputs) };
  } catch (err) {
    if (err instanceof RunConflict) throw new HttpError(409, err.message, { runId: err.runId || undefined });
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});
