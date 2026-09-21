/**
 * Routing engine — §10, implements the pseudocode in §10.5 exactly. Safety is evaluated before
 * NPS tier; the first matching mandatory safety rule wins.
 */
import type { RouteAction } from "../contracts";

export interface RoutingInput {
  score: number;
  safetyFlagged: boolean;
  requiresImmediateReview: boolean;
  reviewEligible: boolean;
}

export interface RoutingDecision {
  action: RouteAction;
  priority: "p0" | "standard";
  slaSeconds: number | null;
}

export function route(input: RoutingInput): RoutingDecision {
  // §10.1 — P0 clinical page. Suppresses review/micro-poll regardless of score.
  if (input.safetyFlagged && input.requiresImmediateReview) {
    return { action: "p0_clinical_page", priority: "p0", slaSeconds: 15 * 60 };
  }
  // §10.2 — 24h CS ticket for detractors, once no P0 condition applies.
  if (input.score <= 6) {
    return { action: "cs_ticket", priority: "standard", slaSeconds: 24 * 60 * 60 };
  }
  // §10.3 — review prompt for promoters, subject to eligibility checks upstream.
  if (input.score >= 9 && input.reviewEligible) {
    return { action: "review_prompt", priority: "standard", slaSeconds: null };
  }
  // §10.4 — in-session micro-poll for passives (and promoters who aren't review-eligible).
  return { action: "micro_poll", priority: "standard", slaSeconds: null };
}
