import { readFile } from "node:fs/promises";
import path from "node:path";
import { handle, HttpError, type Ctx } from "@/lib/http";
import { ARTIFACT_ROOT } from "@/lib/runner";

const TYPES: Record<string, string> = { ".png": "image/png", ".csv": "text/csv; charset=utf-8" };

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string; name: string }>) => {
  const { id, name } = await params;
  // Only flat, known artifact names; no path traversal.
  if (!/^[a-z0-9]+$/i.test(id) || !/^[a-z0-9-]+\.(png|csv)$/i.test(name)) throw new HttpError(400, "Invalid artifact name.");
  const file = await readFile(path.join(ARTIFACT_ROOT, id, name)).catch(() => null);
  if (!file) throw new HttpError(404, "Artifact not found.");
  const ext = path.extname(name).toLowerCase();
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": TYPES[ext],
      "x-content-type-options": "nosniff",
      ...(ext === ".csv" ? { "content-disposition": `attachment; filename="repeatone-${id}.csv"` } : {}),
    },
  });
});
