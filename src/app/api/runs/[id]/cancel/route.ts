import { handle, HttpError, type Ctx } from "@/lib/http";
import { cancelRun } from "@/lib/runner";

export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!cancelRun(id)) throw new HttpError(409, "This run is not active.");
  return { ok: true };
});
