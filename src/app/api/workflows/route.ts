import { db } from "@/lib/db";
import { handle, HttpError, readJson } from "@/lib/http";
import { reconcileRun } from "@/lib/runner";
import { planWorkflow } from "@/lib/planner";
import { globalPrefixes, isUrlAllowed } from "@/lib/safety";
import { CreateWorkflow } from "@/lib/schemas";

export const GET = handle(async () => {
  const rows = await db.workflow.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, status: true, updatedAt: true, runs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } } },
  });
  return Promise.all(rows.map(async ({ runs, ...w }) => ({ ...w, lastRunStatus: runs[0] ? (await reconcileRun(runs[0])).status : null })));
});

/** Validate → let Opus inspect the real page and propose → persist as needs_approval. Nothing runs here. */
export const POST = handle(async (req: Request) => {
  const body = CreateWorkflow.parse(await readJson(req));
  const names = body.inputs.map((i) => i.name);
  if (new Set(names).size !== names.length) throw new HttpError(400, "Input names must be unique.");
  let url: URL;
  try {
    url = new URL(body.startUrl);
  } catch {
    throw new HttpError(400, "Start URL is not a valid URL. Use a full http(s) address.");
  }
  const prefixes = globalPrefixes().filter((p) => isUrlAllowed(url.href, [p]));
  if (!prefixes.length) throw new HttpError(400, `Start URL is not allowed. Permitted prefixes: ${globalPrefixes().join(", ")}`);

  const maxSteps = Number(process.env.MAX_RUN_STEPS || 30);
  let planned;
  try {
    planned = await planWorkflow({ task: body.task, startUrl: url.href, inputs: body.inputs, prefixes, maxSteps });
  } catch (err) {
    throw new HttpError(502, `Planning failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const wf = await db.workflow.create({
    data: {
      name: body.name || planned.proposal.name,
      task: body.task,
      startUrl: url.href,
      allowedPrefixes: JSON.stringify(prefixes),
      inputs: JSON.stringify(body.inputs),
      steps: JSON.stringify(planned.proposal.steps),
      planNotes: planned.proposal.notes,
      planMeta: JSON.stringify(planned.meta),
      recoveryPolicy: body.recoveryPolicy,
      status: "needs_approval",
    },
  });
  return { id: wf.id };
});
