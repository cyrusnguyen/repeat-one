import { z } from "zod";

const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const selector = z.string().trim().min(1).max(300).describe("Playwright selector seen in observe output, e.g. #min-amount");
const description = z.string().trim().min(1).max(300).describe("Intended effect of this step, in plain language");

export const InputDef = z.object({
  name: z.string().regex(NAME, "Input names must start with a letter and use letters, digits or _"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["number", "text"]),
  default: z.string().max(200),
});
export type InputDef = z.infer<typeof InputDef>;

export const Check = z.discriminatedUnion("type", [
  z.object({ type: z.literal("visible"), selector }),
  z.object({
    type: z.literal("rowCount"),
    source: z.enum(["table", "csv"]),
    min: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("everyRow"),
    source: z.enum(["table", "csv"]),
    column: z.string().min(1).max(80).describe("Header text of the column"),
    op: z.enum(["eq", "gte", "lte", "contains"]),
    value: z.string().max(200).describe("May reference inputs as {{name}}"),
  }),
  z.object({ type: z.literal("csvMatchesTable") }),
]);
export type Check = z.infer<typeof Check>;

export const Step = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), url: z.string().min(1).max(500), description }),
  z.object({ action: z.literal("fill"), selector, value: z.string().max(200).describe("May reference inputs as {{name}}"), description }),
  z.object({ action: z.literal("select"), selector, value: z.string().max(200), description }),
  z.object({ action: z.literal("click"), selector, description }),
  z.object({ action: z.literal("wait"), selector, text: z.string().max(200).optional().describe("Optional text the element must contain"), description }),
  z.object({ action: z.literal("extract"), selector: selector.describe("Selector of a <table>"), description }),
  z.object({ action: z.literal("download"), selector: selector.describe("Element whose click triggers a CSV download"), description }),
  z.object({ action: z.literal("screenshot"), description }),
  z.object({ action: z.literal("assert"), check: Check, description }),
]);
export type Step = z.infer<typeof Step>;

export const Proposal = z.object({
  name: z.string().trim().min(1).max(80).describe("Short workflow name"),
  notes: z.string().max(1000).describe("Assumptions and anything the reviewer should know"),
  steps: z.array(Step).min(1),
});
export type Proposal = z.infer<typeof Proposal>;

export const CreateWorkflow = z.object({
  name: z.string().trim().max(80).default(""),
  startUrl: z.string().trim().min(1, "Enter a starting URL"),
  task: z.string().trim().min(10, "Describe the task in at least a sentence").max(2000),
  inputs: z.array(InputDef).max(10),
});

/** Replace {{name}} with input values; unknown names are an error so a typo never runs silently. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`Unknown input {{${name}}}`);
    return values[name];
  });
}

/** Validate run-time input values against definitions; returns a clean record or throws a readable error. */
export function resolveInputs(defs: InputDef[], given: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs) {
    const raw = given[def.name] ?? def.default;
    const value = String(raw).trim();
    if (def.type === "number" && (value === "" || !Number.isFinite(Number(value)))) {
      throw new Error(`${def.label} must be a number`);
    }
    if (value.length > 200) throw new Error(`${def.label} is too long`);
    out[def.name] = value;
  }
  return out;
}

/** Every {{name}} a step uses must be a defined input, and the plan must verify something. */
export function validatePlan(steps: Step[], inputs: InputDef[], maxSteps: number): string[] {
  const errors: string[] = [];
  if (steps.length > maxSteps) errors.push(`Plan has ${steps.length} steps; the limit is ${maxSteps}.`);
  if (!steps.some((s) => s.action === "assert")) errors.push("Plan must include at least one assert step so success is verified, not assumed.");
  const names = new Set(inputs.map((i) => i.name));
  steps.forEach((s, i) => {
    for (const m of JSON.stringify(s).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (!names.has(m[1])) errors.push(`Step ${i + 1} references unknown input {{${m[1]}}}.`);
    }
  });
  return errors;
}

/** Human-readable target of a step for review and run logs. */
export function stepTarget(step: Step): string {
  if (step.action === "navigate") return step.url;
  if (step.action === "assert") {
    const c = step.check;
    if (c.type === "visible") return c.selector;
    if (c.type === "rowCount") return `${c.source} rows ≥ ${c.min}`;
    if (c.type === "everyRow") return `${c.source}: every ${c.column} ${c.op} ${c.value}`;
    return "CSV = page table";
  }
  if (step.action === "screenshot") return "page";
  const value = "value" in step ? ` = "${step.value}"` : step.action === "wait" && step.text ? ` contains "${step.text}"` : "";
  return `${step.selector}${value}`;
}
