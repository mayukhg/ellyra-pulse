import { describe, expect, it } from "vitest";
import { route } from "../routing";

describe("route", () => {
  it("routes a safety-flagged session to P0 regardless of score", () => {
    const decision = route({
      score: 10,
      safetyFlagged: true,
      requiresImmediateReview: true,
      reviewEligible: true,
    });
    expect(decision).toEqual({ action: "p0_clinical_page", priority: "p0", slaSeconds: 900 });
  });

  it("routes a detractor score to a CS ticket with a 24h SLA", () => {
    const decision = route({
      score: 3,
      safetyFlagged: false,
      requiresImmediateReview: false,
      reviewEligible: false,
    });
    expect(decision).toEqual({
      action: "cs_ticket",
      priority: "standard",
      slaSeconds: 24 * 60 * 60,
    });
  });

  it("routes a passive score to a micro-poll", () => {
    const decision = route({
      score: 7,
      safetyFlagged: false,
      requiresImmediateReview: false,
      reviewEligible: false,
    });
    expect(decision.action).toBe("micro_poll");
  });

  it("routes an eligible promoter to a review prompt", () => {
    const decision = route({
      score: 9,
      safetyFlagged: false,
      requiresImmediateReview: false,
      reviewEligible: true,
    });
    expect(decision.action).toBe("review_prompt");
  });

  it("falls back to micro-poll for a promoter score that isn't review-eligible", () => {
    const decision = route({
      score: 10,
      safetyFlagged: false,
      requiresImmediateReview: false,
      reviewEligible: false,
    });
    expect(decision.action).toBe("micro_poll");
  });

  it("boundary: score 6 is a detractor, score 7 is not", () => {
    expect(
      route({
        score: 6,
        safetyFlagged: false,
        requiresImmediateReview: false,
        reviewEligible: false,
      }).action,
    ).toBe("cs_ticket");
    expect(
      route({
        score: 7,
        safetyFlagged: false,
        requiresImmediateReview: false,
        reviewEligible: false,
      }).action,
    ).toBe("micro_poll");
  });
});
