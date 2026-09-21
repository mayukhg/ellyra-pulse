import { describe, expect, it } from "vitest";
import { runSafetyGate } from "../safetyGate";

describe("runSafetyGate", () => {
  it("flags self-harm language with immediate-review", () => {
    const result = runSafetyGate(
      "I mentioned feeling like I might self-harm and it just moved on.",
    );
    expect(result.flagged).toBe(true);
    expect(result.requiresImmediateReview).toBe(true);
    expect(result.reasonCodes).toContain("self_harm_or_emergency");
  });

  it("flags a clinician contradiction", () => {
    const result = runSafetyGate("The summary contradicted what my radiologist told me directly.");
    expect(result.flagged).toBe(true);
    expect(result.reasonCodes).toContain("contradicts_clinician");
  });

  it("does not flag benign positive feedback", () => {
    const result = runSafetyGate(
      "The explanation matched what my GP told me afterwards, which was reassuring.",
    );
    expect(result.flagged).toBe(false);
    expect(result.reasonCodes).toHaveLength(0);
  });

  it("does not flag benign negative-but-non-clinical feedback", () => {
    const result = runSafetyGate("The app felt slow and the billing page was confusing.");
    expect(result.flagged).toBe(false);
  });
});
