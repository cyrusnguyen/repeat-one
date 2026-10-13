import { db } from "@/lib/db";
import { handle, HttpError, type Ctx } from "@/lib/http";
import { planWorkflow } from "@/lib/planner";
import { globalPrefixes, isUrlAllowed } from "@/lib/safety";
import { InputDef } from "@/lib/schemas";
import { loadWorkflow } from "@/lib/store";
import { z } from "zod";

/** Re-plan against the current page. The new plan replaces the steps and must be approved again. */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const row = await loadWorkflow(id);
  const inputs = z.array(InputDef).parse(JSON.parse(row.inputs));
  const prefixes = globalPrefixes().filter((p) => isUrlAllowed(row.startUrl, [p]));
  if (!prefixes.length) throw new HttpError(400, "The start URL is no longer in the server allowlist.");
  let planned;
  try {
    planned = await planWorkflow({ task: row.task, startUrl: row.startUrl, inputs, prefixes, maxSteps: Number(process.env.MAX_RUN_STEPS || 30) });
  } catch (err) {
    throw new HttpError(502, `Planning failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await db.workflow.update({
    where: { id },
    data: {
      steps: JSON.stringify(planned.proposal.steps),
      planNotes: planned.proposal.notes,
      planMeta: JSON.stringify(planned.meta),
      allowedPrefixes: JSON.stringify(prefixes),
      status: "needs_approval",
    },
  });
  return { ok: true };
});
