import { describe, expect, it } from "vitest";
import { noRepairReason } from "./recovery";

describe("noRepairReason", () => {
  it("keeps a long explanation instead of discarding it, shortened to 600 characters", () => {
    const long = "The page has no CSV export control. " + "x".repeat(900);
    const reason = noRepairReason({ reason: long });
    expect(reason.startsWith("The page has no CSV export control.")).toBe(true);
    expect(reason.length).toBeLessThanOrEqual(601);
  });
  it("falls back only when there is no usable reason", () => {
    expect(noRepairReason({})).toBe("Model stopped without a valid reason.");
    expect(noRepairReason({ reason: "   " })).toBe("Model stopped without a valid reason.");
  });
  it("redacts secrets in the reason", () => {
    expect(noRepairReason({ reason: "token: sk-ant-abc123secret" })).not.toContain("sk-ant-abc123secret");
  });
});
