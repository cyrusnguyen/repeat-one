import { describe, expect, it } from "vitest";
import { assertTransition, IllegalTransition, isActive, isTerminal } from "./state";

describe("run state machine", () => {
  it("allows the happy path and the recovery loop", () => {
    for (const [from, to] of [
      ["queued", "running"], ["running", "recovering"], ["recovering", "running"], ["recovering", "needs_approval"],
      ["needs_approval", "running"], ["running", "succeeded"], ["needs_approval", "cancelled"], ["recovering", "failed"],
    ] as const) expect(() => assertTransition(from, to)).not.toThrow();
  });
  it("rejects illegal transitions", () => {
    for (const [from, to] of [
      ["succeeded", "running"], ["failed", "succeeded"], ["cancelled", "running"], ["queued", "succeeded"],
      ["queued", "needs_approval"], ["needs_approval", "succeeded"], ["recovering", "succeeded"], ["bogus", "running"],
    ] as const) expect(() => assertTransition(from, to)).toThrow(IllegalTransition);
  });
  it("classifies terminal and active states", () => {
    expect(isTerminal("succeeded") && isTerminal("failed") && isTerminal("cancelled")).toBe(true);
    expect(isTerminal("needs_approval")).toBe(false);
    expect(["queued", "running", "recovering", "needs_approval"].every(isActive)).toBe(true);
    expect(isActive("failed")).toBe(false);
  });
});
