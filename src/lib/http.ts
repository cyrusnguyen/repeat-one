import { NextResponse } from "next/server";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/** Requiring JSON forces a CORS preflight, so other sites in the user's browser cannot trigger runs on localhost. */
export async function readJson(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Send JSON (Content-Type: application/json).");
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const result = await fn(...args);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
      if (err instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(err) }, { status: 400 });
      console.error(err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
    }
  };
}

export type Ctx<P> = { params: Promise<P> };
