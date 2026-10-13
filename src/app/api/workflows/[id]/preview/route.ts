import { handle, HttpError, readJson, type Ctx } from "@/lib/http";
import { previewPlan } from "@/lib/preview";
import { globalPrefixes, isUrlAllowed } from "@/lib/safety";
import { loadWorkflow, parseWorkflow } from "@/lib/store";

// Read-only, so it is allowed before approval. One preview at a time per workflow.
const g = globalThis as unknown as { previews?: Set<string> };
const busy = (g.previews ??= new Set());

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  await readJson(req);
  const { id } = await params;
  const wf = parseWorkflow(await loadWorkflow(id));
  const prefixes = wf.allowedPrefixes.filter((p) => isUrlAllowed(p, globalPrefixes()));
  if (!prefixes.length) throw new HttpError(400, "This workflow's permitted URLs are no longer in the server allowlist.");
  if (busy.has(id)) throw new HttpError(409, "A preview for this workflow is already running.");
  busy.add(id);
  try {
    return { items: await previewPlan(wf.startUrl, wf.steps, wf.inputs, prefixes) };
  } finally {
    busy.delete(id);
  }
});
