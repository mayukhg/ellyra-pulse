import type { FeatureKey } from "../contracts";

export const DEFAULT_SEED = 20260921;

export const FEATURE_WEIGHTS = [
  ["lab_blood_parser", 32],
  ["mri_imaging_insights", 16],
  ["symptom_chat_companion", 38],
  ["gp_question_builder", 14],
] as const satisfies ReadonlyArray<readonly [FeatureKey, number]>;

export const COHORTS = [
  { cohortKey: "new_lt_30d", cohortName: "New (<30d)", tenureBand: "<30d", planType: "free" },
  {
    cohortKey: "established_30_180d",
    cohortName: "Established (30-180d)",
    tenureBand: "30-180d",
    planType: "plus",
  },
  {
    cohortKey: "tenured_gt_180d",
    cohortName: "Tenured (>180d)",
    tenureBand: ">180d",
    planType: "plus",
  },
  {
    cohortKey: "premium_active",
    cohortName: "Premium active",
    tenureBand: "30-180d",
    planType: "premium",
  },
] as const;

export type CohortKey = (typeof COHORTS)[number]["cohortKey"];

export type TierCounts = { promoters: number; passives: number; detractors: number };

export type SurveyMix = {
  relational: TierCounts;
  transactional: TierCounts;
};

/**
 * Integer mixes that hit the published NPS targets under the product formula
 * (one-decimal percentages, then round). A 44.4% relational share is the
 * continuous solution for +57 / +52 / +61, and it is not an integer count of
 * 2,400. 1,050 / 2,400 produces those three scores exactly.
 * The prior window uses 880 / 2,200 so +53 / +50 / +55 are exact too.
 */
export const DEMO_MIX: SurveyMix = {
  relational: { promoters: 672, passives: 252, detractors: 126 },
  transactional: { promoters: 960, passives: 252, detractors: 138 },
};

export const PRIOR_MIX: SurveyMix = {
  relational: { promoters: 528, passives: 264, detractors: 88 },
  transactional: { promoters: 924, passives: 198, detractors: 198 },
};

export interface BucketQuota {
  id: "mar" | "apr" | "may" | "jun" | "jul_early" | "prior" | "demo";
  from: string;
  to: string;
  responses: number;
  eligibleInvitations: number;
  ineligibleInvitations: number;
  clinicalSessions: number;
  relationalNps: number;
  transactionalNps: number;
  mix: SurveyMix;
}

export const BUCKETS: readonly BucketQuota[] = [
  bucket("mar", "2026-03-01", "2026-04-01", 1800, 7800, 678, 12092, 41, 49, "search"),
  bucket("apr", "2026-04-01", "2026-05-01", 1800, 7800, 678, 12092, 44, 52, "search"),
  bucket("may", "2026-05-01", "2026-06-01", 1800, 7800, 678, 12092, 43, 55, "search"),
  bucket("jun", "2026-06-01", "2026-07-01", 1800, 7800, 678, 12092, 47, 56, "search"),
  bucket("jul_early", "2026-07-01", "2026-07-23", 1800, 7800, 678, 12092, 49, 58, "search"),
  bucket("prior", "2026-07-23", "2026-08-22", 2200, 9910, 862, 13636, 50, 55, "prior"),
  bucket("demo", "2026-08-22", "2026-09-21", 2400, 10084, 877, 12903, 52, 61, "demo"),
];

export const DEMO_BUCKET = BUCKETS[6]!;
export const PRIOR_BUCKET = BUCKETS[5]!;

export const MISMATCH_CODES = [
  "contradicts_clinician",
  "ocr_unit_mismatch",
  "missed_abnormal_marker",
  "false_reassurance",
] as const;

export const HARM_CODES = [
  "self_harm_or_emergency",
  "medication_danger",
  "urgent_symptom_minimisation",
] as const;

export interface ClockQuota {
  verbatimMismatch: number;
  /** Prior window only: safety verbatims that sit on detractors, so they take a P0 instead of a CS ticket. */
  verbatimMismatchOnDetractors: number;
  sessionMismatch: number;
  sessionHarm: number;
  p0Open: number;
  p0Late: number;
  pageFailures: number;
  /** Resolved tickets / all tickets in the window, after the safety overlap above. */
  resolvedTickets: number;
}

export const CLOCKS: Partial<Record<BucketQuota["id"], ClockQuota>> = {
  demo: {
    verbatimMismatch: 15,
    verbatimMismatchOnDetractors: 0,
    sessionMismatch: 25,
    sessionHarm: 8,
    p0Open: 3,
    p0Late: 2,
    pageFailures: 2,
    resolvedTickets: 231,
  },
  prior: {
    verbatimMismatch: 15,
    verbatimMismatchOnDetractors: 2,
    sessionMismatch: 15,
    sessionHarm: 8,
    p0Open: 2,
    p0Late: 3,
    pageFailures: 0,
    resolvedTickets: 219,
  },
};

export const ARD = {
  demo: { pairs: 1000, improved: 784, incomplete: 200 },
  prior: { pairs: 1000, improved: 763, incomplete: 200 },
} as const;

export const CCS = {
  demo: { answers: 1000, understood: 826, imagingAnswers: 370, imagingUnderstood: 259 },
  prior: { answers: 1000, understood: 834, imagingAnswers: 330, imagingUnderstood: 231 },
} as const;

export const DFI = {
  demo: { exposed: 1200, negative: 82 },
  prior: { exposed: 1200, negative: 67 },
} as const;

export const QUARANTINE_PER_BUCKET = 12;

export const TELEMETRY = {
  sessions: 2000,
  desktop: 1240,
  mobile: 560,
  tablet: 200,
  desktopFrustrated: 136,
  mobileFrustrated: 185,
  tabletFrustrated: 119,
  completed: 476,
} as const;

export const SUPPRESSION = {
  bucketId: "mar" as const,
  featureKey: "gp_question_builder" as const,
  cohortKey: "premium_active" as const,
  responses: 12,
};

export const PINNED_THEMES = [
  {
    featureKey: "lab_blood_parser" as const,
    aspect: "document_parsing_ocr" as const,
    critical: true,
    note: "OCR decimal misread on a blood panel",
    demoMentions: 40,
  },
  {
    featureKey: "lab_blood_parser" as const,
    aspect: "clinical_trust" as const,
    critical: true,
    note: "Missed abnormal marker",
    demoMentions: 40,
  },
  {
    featureKey: "symptom_chat_companion" as const,
    aspect: "clinical_trust" as const,
    critical: true,
    note: "Medication danger called out in chat",
    demoMentions: 40,
  },
  {
    featureKey: "gp_question_builder" as const,
    aspect: "billing_cost" as const,
    critical: false,
    note: "Low-volume billing mention, not a safety pin",
    demoMentions: 8,
  },
] as const;

export function featureCounts(total: number): Record<FeatureKey, number> {
  const counts = {} as Record<FeatureKey, number>;
  let assigned = 0;
  for (const [key, weight] of FEATURE_WEIGHTS) {
    const count = (total * weight) / 100;
    if (!Number.isInteger(count)) {
      throw new Error(`Feature weight ${weight} does not divide ${total}`);
    }
    counts[key] = count;
    assigned += count;
  }
  if (assigned !== total) throw new Error(`Feature counts sum to ${assigned}, expected ${total}`);
  return counts;
}

export function mixTotal(mix: SurveyMix): number {
  return tierTotal(mix.relational) + tierTotal(mix.transactional);
}

export function tierTotal(tier: TierCounts): number {
  return tier.promoters + tier.passives + tier.detractors;
}

/** Product NPS: one-decimal tier percentages, then round the difference. */
export function npsOf(promoters: number, detractors: number, total: number): number {
  if (total === 0) return 0;
  const promotersPct = Number(((promoters / total) * 100).toFixed(1));
  const detractorsPct = Number(((detractors / total) * 100).toFixed(1));
  return Math.round(promotersPct - detractorsPct);
}

function bucket(
  id: BucketQuota["id"],
  from: string,
  to: string,
  responses: number,
  eligibleInvitations: number,
  ineligibleInvitations: number,
  clinicalSessions: number,
  relationalNps: number,
  transactionalNps: number,
  mixKind: "search" | "prior" | "demo",
): BucketQuota {
  const mix =
    mixKind === "demo"
      ? DEMO_MIX
      : mixKind === "prior"
        ? PRIOR_MIX
        : searchMix(responses, relationalNps, transactionalNps);
  if (mixTotal(mix) !== responses) {
    throw new Error(`${id} mix sums to ${mixTotal(mix)}, expected ${responses}`);
  }
  return {
    id,
    from,
    to,
    responses,
    eligibleInvitations,
    ineligibleInvitations,
    clinicalSessions,
    relationalNps,
    transactionalNps,
    mix,
  };
}

function searchMix(total: number, relTarget: number, txTarget: number): SurveyMix {
  const relTotal = Math.round(total * 0.444);
  const txTotal = total - relTotal;
  return {
    relational: tierSplit(relTotal, relTarget),
    transactional: tierSplit(txTotal, txTarget),
  };
}

function tierSplit(total: number, target: number): TierCounts {
  // A zero-detractor split can hit the NPS number and still leave the month with no
  // closed-loop tickets. Prefer a split that keeps both detractors and passives.
  const minDetractors = Math.max(1, Math.round(total * 0.05));
  const minPassives = Math.max(1, Math.round(total * 0.05));
  for (let detractors = minDetractors; detractors <= Math.round(total * 0.25); detractors++) {
    for (let passives = minPassives; passives <= total - detractors; passives++) {
      const promoters = total - detractors - passives;
      if (npsOf(promoters, detractors, total) === target) {
        return { promoters, passives, detractors };
      }
    }
  }
  throw new Error(`No NPS split for n=${total} target=${target}`);
}
