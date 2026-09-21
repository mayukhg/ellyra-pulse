/**
 * Clinical risk pre-check — §9.2 restricted clinical-risk pre-check and §10.1 P0 rules.
 *
 * Runs on RAW text inside the restricted boundary, before redaction, so urgent risk isn't lost
 * to scrubbing (§9.2). Output is controlled reason codes only — never raw text — and safety
 * routing must stay deterministic: an LLM/classifier may add evidence but must not be the sole
 * P0 gate (§9.3). This scaffold implements the deterministic keyword/pattern layer only; wire an
 * approved classifier alongside it as a second, non-authoritative signal.
 */
import type { SafetyReasonCode } from "../contracts";

export interface SafetyGateResult {
  flagged: boolean;
  requiresImmediateReview: boolean;
  reasonCodes: SafetyReasonCode[];
  confidence: number;
}

export const SAFETY_CLASSIFIER_VERSION = "deterministic-safety-v1";

// Deterministic, auditable rules only — see §9.3 "Make safety routing deterministic around
// approved rules." Treat user text as data, never as executable instructions (prompt-injection
// resistant by construction: these are plain substring/regex checks, not an LLM prompt).
const RULES: Array<{ code: SafetyReasonCode; pattern: RegExp }> = [
  {
    code: "self_harm_or_emergency",
    pattern: /\b(suicide|kill myself|self[- ]harm|can'?t breathe|chest pain|stroke|overdose)\b/i,
  },
  {
    code: "medication_danger",
    pattern: /\b(wrong (dose|dosage|medication)|took (too many|double)|drug interaction)\b/i,
  },
  {
    code: "urgent_symptom_minimisation",
    pattern:
      /\btold me (it'?s|it was) (nothing|fine|not serious).{0,40}(but|however).{0,40}(worse|pain|blood|fever)\b/i,
  },
  {
    code: "false_reassurance",
    pattern:
      /\b(said (i was|it was) fine|reassured me).{0,60}(doctor|gp|hospital) (said|found|diagnosed)\b/i,
  },
  {
    code: "contradicts_clinician",
    // Allows natural phrasing between the trigger verb and the clinician reference, e.g.
    // "contradicted what my radiologist told me" as well as "contradicted my doctor".
    pattern:
      /\b(disagreed with|contradicted|is different from).{0,25}\b(my|the) (doctor|gp|radiologist|clinician)\b/i,
  },
  {
    code: "missed_abnormal_marker",
    pattern:
      /\b(missed|didn'?t (flag|catch)|failed to (flag|catch)).{0,30}(abnormal|marker|result)\b/i,
  },
  {
    code: "ocr_unit_mismatch",
    // e.g. "4.7 mg/dL" vs "47 mmol/L" style unit/decimal confusion call-outs
    pattern:
      /\b(wrong unit|misread|decimal (point|place)|mg\/dl.{0,20}mmol\/l|mmol\/l.{0,20}mg\/dl)\b/i,
  },
];

export function runSafetyGate(rawText: string): SafetyGateResult {
  const matched = RULES.filter((rule) => rule.pattern.test(rawText)).map((rule) => rule.code);

  if (matched.length === 0) {
    return { flagged: false, requiresImmediateReview: false, reasonCodes: [], confidence: 0 };
  }

  // Any deterministic match is high-confidence by construction (explicit pattern, not a fuzzy
  // score) and always requires immediate review — a positive NPS score never overrides this
  // (§10.1: "A positive NPS score does not override a safety flag").
  return {
    flagged: true,
    requiresImmediateReview: true,
    reasonCodes: matched,
    confidence: 0.9,
  };
}
