import { getVariant, renderPortal } from "@/lib/demo-portal";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(renderPortal(getVariant()), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
