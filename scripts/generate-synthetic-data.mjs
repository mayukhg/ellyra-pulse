#!/usr/bin/env node
/**
 * Generates a synthetic dataset shaped like the canonical schema in
 * db/migrations/0001_init.sql (§3 of docs/UI_INTEGRATION_REQUIREMENTS.md), for local backend
 * development and frontend fixtures. Deterministic (seeded PRNG) so re-running produces the
 * same dataset.
 *
 * Usage: node scripts/generate-synthetic-data.mjs
 * Output: data/synthetic/*.json (committed to the repo, see data/synthetic/README.md)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "data", "synthetic");
mkdirSync(OUT_DIR, { recursive: true });

// --- seeded PRNG (mulberry32) so the dataset is reproducible ---------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260921);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const int = (min, max) => Math.floor(min + rand() * (max - min + 1));

const RESPONSE_COUNT = 8000;
const START_DATE = new Date("2026-03-01T00:00:00Z").getTime();
const END_DATE = new Date("2026-09-21T00:00:00Z").getTime();

// --- dimensions --------------------------------------------------------------

const FEATURES = [
  {
    featureKey: "lab_blood_parser",
    featureName: "Lab / Blood Report Parser",
    productArea: "lab",
    touchpointType: "report",
    isClinical: true,
    targetNps: 62,
    volumeShare: 0.32,
  },
  {
    featureKey: "mri_imaging_insights",
    featureName: "MRI / Imaging Insights",
    productArea: "imaging",
    touchpointType: "report",
    isClinical: true,
    targetNps: 48,
    volumeShare: 0.16,
  },
  {
    featureKey: "symptom_chat_companion",
    featureName: "Symptom Chat Companion",
    productArea: "chat",
    touchpointType: "conversation",
    isClinical: true,
    targetNps: 51,
    volumeShare: 0.38,
  },
  {
    featureKey: "gp_question_builder",
    featureName: "GP Question Builder",
    productArea: "gp_prep",
    touchpointType: "builder",
    isClinical: false,
    targetNps: 71,
    volumeShare: 0.14,
  },
];
FEATURES.forEach((f) => (f.featureTouchpointId = randomUUID()));

const COHORTS = [
  { cohortKey: "new_lt_30d", cohortName: "New (<30d)", tenureBand: "<30d", planType: "free" },
  { cohortKey: "established_30_180d", cohortName: "Established (30-180d)", tenureBand: "30-180d", planType: "plus" },
  { cohortKey: "tenured_gt_180d", cohortName: "Tenured (>180d)", tenureBand: ">180d", planType: "plus" },
  { cohortKey: "premium_active", cohortName: "Premium active", tenureBand: "30-180d", planType: "premium" },
].map((c) => ({ ...c, userCohortId: randomUUID(), isActive: true }));

const ASPECT_TAXONOMY = [
  "clinical_trust",
  "tone_and_bedside_manner",
  "document_parsing_ocr",
  "actionability",
  "billing_cost",
  "ui_confusion",
  "response_speed",
];
const CLINICAL_ASPECTS = new Set([
  "clinical_trust",
  "tone_and_bedside_manner",
  "document_parsing_ocr",
  "actionability",
]);

// Per-feature aspect bias: which aspects that feature's feedback tends to mention, and whether
// the mention skews positive or negative. Mirrors the "top driver" flavor text used across
// docs/DESIGN.md and the prototype's mock data (src/lib/nps-data.ts).
const FEATURE_ASPECT_BIAS = {
  lab_blood_parser: [
    { aspect: "clinical_trust", positiveWeight: 0.75 },
    { aspect: "document_parsing_ocr", positiveWeight: 0.55 },
    { aspect: "actionability", positiveWeight: 0.7 },
  ],
  mri_imaging_insights: [
    { aspect: "actionability", positiveWeight: 0.4 }, // "needs deeper detail" — leans negative
    { aspect: "clinical_trust", positiveWeight: 0.6 },
    { aspect: "response_speed", positiveWeight: 0.5 },
  ],
  symptom_chat_companion: [
    { aspect: "tone_and_bedside_manner", positiveWeight: 0.72 },
    { aspect: "clinical_trust", positiveWeight: 0.58 },
    { aspect: "ui_confusion", positiveWeight: 0.6 },
  ],
  gp_question_builder: [
    { aspect: "actionability", positiveWeight: 0.85 },
    { aspect: "response_speed", positiveWeight: 0.7 },
  ],
};

const POSITIVE_SNIPPETS = {
  clinical_trust: "The explanation matched what my GP told me afterwards, which was reassuring.",
  tone_and_bedside_manner: "It felt calm and genuinely kind, not robotic at all.",
  document_parsing_ocr: "It read my scanned PDF cleanly, even the blurry second page.",
  actionability: "Gave me a short list of questions to bring to my consultant.",
  billing_cost: "Felt like fair value for what it does.",
  ui_confusion: "Simple to navigate, found what I needed immediately.",
  response_speed: "Answered almost instantly.",
};
const NEGATIVE_SNIPPETS = {
  clinical_trust: "It told me my result was alarming when my doctor later said it was normal.",
  tone_and_bedside_manner: "The tone felt cold and clinical, made me more anxious.",
  document_parsing_ocr: "It failed to parse page 2 of my MRI report at all.",
  actionability: "Just told me to consult a doctor without explaining anything useful.",
  billing_cost: "Ran into a confusing billing charge I didn't expect.",
  ui_confusion: "Took a while to figure out where to upload my report.",
  response_speed: "Felt slow, I waited almost a minute for a reply.",
};

const SAFETY_REASON_CODES = [
  "ocr_unit_mismatch",
  "missed_abnormal_marker",
  "contradicts_clinician",
  "false_reassurance",
  "urgent_symptom_minimisation",
  "self_harm_or_emergency",
  "medication_danger",
];
const SAFETY_SNIPPETS = {
  ocr_unit_mismatch: "The report mixed up mg/dL and mmol/L on my glucose reading, which is a wrong unit.",
  missed_abnormal_marker: "It missed an abnormal marker on my panel that my doctor flagged immediately.",
  contradicts_clinician: "The summary contradicted what my radiologist told me directly.",
  false_reassurance: "It reassured me it was fine, but the doctor found something serious.",
  urgent_symptom_minimisation: "It told me my chest pain was nothing but it got worse overnight.",
  self_harm_or_emergency: "I mentioned feeling like I might self-harm and it just moved on.",
  medication_danger: "It suggested a medication dose that was a wrong dosage for my case.",
};

const REDACTION_TAGS = ["DOB", "NAME", "MRN", "NHS_NUMBER", "EMAIL", "PHONE"];
const CHANNELS = ["in_app", "email", "web", "app_store", "ticket"];

function randomTimestamp() {
  return new Date(START_DATE + rand() * (END_DATE - START_DATE)).toISOString();
}

function tierFor(score) {
  if (score <= 6) return "detractor";
  if (score <= 8) return "passive";
  return "promoter";
}

// Scores are sampled around each feature's target NPS so the aggregate dashboard numbers land
// close to the figures already used across docs/DESIGN.md and the prototype's mock fixtures.
function sampleScore(targetNps) {
  // Solve promoter%/detractor% so that promoterShare - detractorShare == targetNps/100, with a
  // detractor floor that shrinks as the target score rises (higher-NPS features still have some
  // detractors, just fewer) — keeps the distribution realistic instead of near-unanimous.
  const detractorShare = Math.min(0.25, Math.max(0.05, 0.25 - targetNps * 0.0025));
  const promoterShare = Math.min(0.9, detractorShare + targetNps / 100);
  const passiveShare = Math.max(0.05, 1 - promoterShare - detractorShare);
  const r = rand();
  if (r < detractorShare) return int(0, 6);
  if (r < detractorShare + passiveShare) return int(7, 8);
  return int(9, 10);
}

function buildAspects(featureKey, score) {
  const bias = FEATURE_ASPECT_BIAS[featureKey] ?? [];
  const aspects = [];
  const snippets = [];

  for (const { aspect, positiveWeight } of bias) {
    if (!chance(0.55)) continue; // not every response mentions every biased aspect
    // Detractors skew negative regardless of the feature's usual bias; promoters skew positive.
    const tierAdjustedPositive =
      score <= 6 ? positiveWeight * 0.35 : score >= 9 ? Math.min(0.95, positiveWeight * 1.2) : positiveWeight;
    const isPositive = chance(tierAdjustedPositive);
    aspects.push({ aspect, polarity: isPositive ? 1 : -1, confidence: Number((0.6 + rand() * 0.35).toFixed(2)) });
    snippets.push(isPositive ? POSITIVE_SNIPPETS[aspect] : NEGATIVE_SNIPPETS[aspect]);
  }

  // Occasionally mention an operational aspect regardless of feature.
  if (chance(0.12)) {
    const opAspect = pick(["billing_cost", "ui_confusion", "response_speed"]);
    const isPositive = chance(0.4);
    aspects.push({ aspect: opAspect, polarity: isPositive ? 1 : -1, confidence: 0.65 });
    snippets.push(isPositive ? POSITIVE_SNIPPETS[opAspect] : NEGATIVE_SNIPPETS[opAspect]);
  }

  return { aspects, snippets };
}

function maybeInjectPhi(text) {
  const injected = [];
  let result = text;
  if (chance(0.18)) {
    result += " My DOB is 14/03/1985.";
    injected.push("DOB");
  }
  if (chance(0.15)) {
    result = `Hi, this is Jordan Ellis. ${result}`;
    injected.push("NAME");
  }
  if (chance(0.06)) {
    result += " MRN: A00-4471.";
    injected.push("MRN");
  }
  if (chance(0.05)) {
    result += " Reach me at jordan.ellis@example.com.";
    injected.push("EMAIL");
  }
  return { rawText: result, injectedTags: injected };
}

function redactText(rawText, injectedTags) {
  let redacted = rawText
    .replace(/\b\d{2}[/\-.]\d{2}[/\-.]\d{4}\b/g, "[REDACTED_DOB]")
    .replace(/Jordan Ellis/g, "[REDACTED_NAME]")
    .replace(/MRN:\s*[A-Za-z0-9-]+/g, "[REDACTED_MRN]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[REDACTED_EMAIL]");
  const counts = injectedTags.reduce((acc, tag) => {
    acc[tag] = (acc[tag] ?? 0) + 1;
    return acc;
  }, {});
  return { redacted, redactionTags: Object.keys(counts), redactionCount: Object.values(counts).reduce((a, b) => a + b, 0) };
}

// --- generate responses ------------------------------------------------------

const responses = [];
const tickets = [];
const auditEvents = [];

let remaining = RESPONSE_COUNT;
for (const feature of FEATURES) {
  const count = Math.round(RESPONSE_COUNT * feature.volumeShare);
  remaining -= count;

  for (let i = 0; i < count; i++) {
    const responseId = randomUUID();
    const receivedAt = randomTimestamp();
    const score = sampleScore(feature.targetNps);
    const tier = tierFor(score);
    const surveyType = chance(0.78) ? "transactional" : "relational";
    const cohort = pick(COHORTS);
    const channel = pick(CHANNELS);

    const isSafetyCase = chance(0.0025); // ~0.25% of sessions — matches the hallucination-flag-rate order of magnitude
    let safetyFlag = false;
    let safetyReasonCodes = [];
    let safetyConfidence = null;
    let baseText;
    let aspects = [];

    if (isSafetyCase) {
      const code = pick(SAFETY_REASON_CODES);
      safetyFlag = true;
      safetyReasonCodes = [code];
      safetyConfidence = 0.9;
      baseText = SAFETY_SNIPPETS[code];
    } else {
      const built = buildAspects(feature.featureKey, score);
      aspects = built.aspects;
      baseText = built.snippets.length ? built.snippets.join(" ") : "No specific feedback provided.";
    }

    const { rawText, injectedTags } = maybeInjectPhi(baseText);
    const { redacted, redactionTags, redactionCount } = redactText(rawText, injectedTags);

    const sentiment = aspects.length
      ? Number((aspects.reduce((s, a) => s + a.polarity, 0) / aspects.length).toFixed(3))
      : isSafetyCase
        ? -1
        : 0;

    let routeAction;
    if (safetyFlag) routeAction = "p0_clinical_page";
    else if (score <= 6) routeAction = "cs_ticket";
    else if (score >= 9) routeAction = "review_prompt";
    else routeAction = "micro_poll";

    const response = {
      response_id: responseId,
      external_response_id: `synthetic-${responseId.slice(0, 8)}`,
      source_system: "synthetic-fixture",
      received_at: receivedAt,
      survey_type: surveyType,
      nps_score: score,
      nps_tier: tier,
      feature_touchpoint_id: feature.featureTouchpointId,
      feature_key: feature.featureKey,
      user_cohort_id: cohort.userCohortId,
      session_ref: `sess_${randomUUID().slice(0, 12)}`,
      channel,
      locale: "en-GB",
      response_eligible: true,
      verbatim_redacted: redacted,
      redaction_tags: redactionTags,
      redaction_count: redactionCount,
      redaction_version: "deterministic-v1",
      sentiment_score: sentiment,
      aspects,
      safety_flag: safetyFlag,
      safety_reason_codes: safetyReasonCodes,
      safety_confidence: safetyConfidence,
      route_action: routeAction,
      model_version: pick(["ellyra-core-2026.3", "ellyra-core-2026.4", "ellyra-core-2026.5"]),
      classifier_version: "lexicon-absa-v1",
      processing_status: "routed",
      created_at: receivedAt,
    };
    responses.push(response);

    auditEvents.push({
      audit_id: randomUUID(),
      response_id: responseId,
      stage: "routing",
      status: "completed",
      detail_codes: [routeAction],
      occurred_at: receivedAt,
      request_id: `req_${randomUUID()}`,
    });

    if (routeAction === "cs_ticket" || routeAction === "p0_clinical_page") {
      const createdAt = new Date(receivedAt);
      const slaSeconds = routeAction === "p0_clinical_page" ? 15 * 60 : 24 * 60 * 60;
      const slaDueAt = new Date(createdAt.getTime() + slaSeconds * 1000);

      const statusRoll = rand();
      let status, firstContactAt, resolvedAt, slaBreachedAt;
      if (statusRoll < 0.6) {
        status = "resolved";
        firstContactAt = new Date(createdAt.getTime() + int(2, slaSeconds * 0.8) * 1000).toISOString();
        resolvedAt = new Date(createdAt.getTime() + int(slaSeconds * 0.5, slaSeconds * 3) * 1000).toISOString();
        slaBreachedAt = new Date(resolvedAt) > slaDueAt ? slaDueAt.toISOString() : null;
      } else if (statusRoll < 0.85) {
        status = "contacted";
        firstContactAt = new Date(createdAt.getTime() + int(2, slaSeconds) * 1000).toISOString();
        resolvedAt = null;
        slaBreachedAt = null;
      } else {
        status = "open";
        firstContactAt = null;
        resolvedAt = null;
        slaBreachedAt = Date.now() > slaDueAt.getTime() ? slaDueAt.toISOString() : null;
      }

      tickets.push({
        ticket_id: randomUUID(),
        response_id: responseId,
        ticket_type: routeAction === "p0_clinical_page" ? "p0_clinical" : "customer_success",
        status,
        priority: routeAction === "p0_clinical_page" ? "p0" : "standard",
        owner_team: routeAction === "p0_clinical_page" ? "clinical_safety" : "customer_success",
        owner_id: randomUUID(),
        created_at: createdAt.toISOString(),
        first_contact_at: firstContactAt,
        resolved_at: resolvedAt,
        sla_due_at: slaDueAt.toISOString(),
        sla_breached_at: slaBreachedAt,
        resolution_code: status === "resolved" ? pick(["fixed_in_release", "explained_to_user", "no_action_needed"]) : null,
        last_updated_by: randomUUID(),
        version: status === "open" ? 0 : status === "contacted" ? 1 : 2,
        updated_at: (resolvedAt ?? firstContactAt ?? createdAt.toISOString()),
      });
    }
  }
}

// Fill any rounding remainder onto the highest-volume feature.
if (remaining > 0) {
  console.warn(`Note: ${remaining} rows unassigned by volume-share rounding (dataset size unaffected in practice).`);
}

// --- write outputs ------------------------------------------------------------

writeFileSync(
  path.join(OUT_DIR, "dim_feature_touchpoint.json"),
  JSON.stringify(
    FEATURES.map(({ volumeShare, targetNps, ...f }) => f),
    null,
    2,
  ),
);
writeFileSync(path.join(OUT_DIR, "dim_user_cohort.json"), JSON.stringify(COHORTS, null, 2));
writeFileSync(path.join(OUT_DIR, "fact_nps_response.json"), JSON.stringify(responses));
writeFileSync(path.join(OUT_DIR, "fact_closed_loop_ticket.json"), JSON.stringify(tickets, null, 2));
writeFileSync(path.join(OUT_DIR, "response_processing_audit.json"), JSON.stringify(auditEvents));

console.log(`Generated ${responses.length} responses, ${tickets.length} tickets, ${auditEvents.length} audit events.`);
console.log(`Output: ${OUT_DIR}`);
