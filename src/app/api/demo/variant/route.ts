import { z } from "zod";
import { getVariant, setVariant, VARIANTS } from "@/lib/demo-portal";
import { handle, readJson } from "@/lib/http";

// Demo-only control. Lives under /api, which the browser runner's allowlist never permits.
export const GET = handle(async () => ({ variant: getVariant(), variants: VARIANTS }));

export const POST = handle(async (req: Request) => {
  const { variant } = z.object({ variant: z.enum(VARIANTS) }).parse(await readJson(req));
  setVariant(variant);
  return { variant };
});
