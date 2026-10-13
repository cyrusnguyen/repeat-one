import { handle } from "@/lib/http";
import { globalPrefixes } from "@/lib/safety";

export const GET = handle(async () => {
  const prefixes = globalPrefixes();
  return {
    prefixes,
    demoUrl: new URL("invoices.html", prefixes[0]).href,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    limits: {
      maxModelCalls: Number(process.env.MAX_MODEL_CALLS || 12),
      maxPlanCostUsd: Number(process.env.MAX_PLAN_COST_USD || 1),
      maxRunSteps: Number(process.env.MAX_RUN_STEPS || 30),
      runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS || 60000),
    },
  };
});
