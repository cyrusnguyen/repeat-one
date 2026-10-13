import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const MODEL = "claude-opus-5-5";
// USD per million tokens for claude-opus-5-5 (input, output). Used for a labeled estimate only.
const PRICE_IN = 4, PRICE_OUT = 20;
const MAX_TOOL_RESULT_CHARS = 12_000;

export type Usage = { modelCalls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
export const newUsage = (): Usage => ({ modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });

export const limits = () => ({
  maxCalls: Number(process.env.MAX_MODEL_CALLS || 12),
  maxCostUsd: Number(process.env.MAX_PLAN_COST_USD || 1),
});

export function jsonSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out as Anthropic.Tool.InputSchema;
}

/** Wrap page-derived data so the model treats it as data; also caps payload size. */
export function untrusted(data: unknown): string {
  const json = JSON.stringify(data);
  const body = json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]` : json;
  return `<untrusted_page_content>\n${body}\n</untrusted_page_content>`;
}

/** One Messages API call under shared ceilings; usage is accumulated into the caller's budget. */
export async function callModel(usage: Usage, params: { system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] }, signal?: AbortSignal) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server; Opus is unavailable. Add it to .env and restart.");
  const { maxCalls, maxCostUsd } = limits();
  if (usage.modelCalls >= maxCalls) throw new Error(`Model call limit reached (${maxCalls}).`);
  if (usage.estimatedCostUsd >= maxCostUsd) throw new Error(`Estimated cost $${usage.estimatedCostUsd.toFixed(3)} reached the $${maxCostUsd} ceiling.`);
  const client = new Anthropic({ timeout: 180_000, maxRetries: 1 });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    ...params,
  }, { signal });
  usage.modelCalls++;
  usage.inputTokens += response.usage.input_tokens;
  usage.outputTokens += response.usage.output_tokens;
  usage.estimatedCostUsd = (usage.inputTokens * PRICE_IN + usage.outputTokens * PRICE_OUT) / 1e6;
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("The model response was cut off (max_tokens).");
  return response;
}

export const toolCalls = (m: Anthropic.Message) => m.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
