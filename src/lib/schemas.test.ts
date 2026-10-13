import { describe, expect, it } from "vitest";
import { CreateWorkflow, fillTemplate, Proposal, resolveInputs, validatePlan, type InputDef, type Step } from "./schemas";

const inputs: InputDef[] = [{ name: "minimumAmount", label: "Minimum amount", type: "number", default: "1000" }];

describe("templating and inputs", () => {
  it("fills known inputs and rejects unknown ones", () => {
    expect(fillTemplate("{{minimumAmount}}", { minimumAmount: "500" })).toBe("500");
    expect(fillTemplate("min={{ minimumAmount }}", { minimumAmount: "5" })).toBe("min=5");
    expect(() => fillTemplate("{{other}}", { minimumAmount: "5" })).toThrow(/Unknown input/);
  });
  it("uses defaults and validates numbers", () => {
    expect(resolveInputs(inputs, {})).toEqual({ minimumAmount: "1000" });
    expect(resolveInputs(inputs, { minimumAmount: 2500 })).toEqual({ minimumAmount: "2500" });
    expect(() => resolveInputs(inputs, { minimumAmount: "abc" })).toThrow(/must be a number/);
    expect(() => resolveInputs(inputs, { minimumAmount: "" })).toThrow(/must be a number/);
  });
});

describe("plan validation", () => {
  const steps: Step[] = [
    { action: "fill", selector: "#min-amount", value: "{{minimumAmount}}", description: "set min" },
    { action: "assert", check: { type: "rowCount", source: "table", min: 1 }, description: "has rows" },
  ];
  it("accepts a verified plan", () => expect(validatePlan(steps, inputs, 30)).toEqual([]));
  it("requires an assert step", () => expect(validatePlan(steps.slice(0, 1), inputs, 30).join()).toMatch(/assert/));
  it("rejects unknown inputs and too many steps", () => {
    expect(validatePlan(steps, [], 30).join()).toMatch(/unknown input/);
    expect(validatePlan(steps, inputs, 1).join()).toMatch(/limit is 1/);
  });
  it("rejects malformed AI proposals", () => {
    expect(Proposal.safeParse({ name: "x", notes: "", steps: [{ action: "hack", selector: "x" }] }).success).toBe(false);
    expect(Proposal.safeParse({ name: "x", notes: "", steps: [{ action: "click", description: "no selector" }] }).success).toBe(false);
    expect(Proposal.safeParse({ name: "x", notes: "", steps: [] }).success).toBe(false);
  });
  it("rejects empty prompts and bad input names", () => {
    expect(CreateWorkflow.safeParse({ startUrl: "http://x", task: "", inputs: [] }).success).toBe(false);
    expect(CreateWorkflow.safeParse({ startUrl: "http://x", task: "Export unpaid invoices", inputs: [{ name: "1bad", label: "x", type: "text", default: "" }] }).success).toBe(false);
  });
});
