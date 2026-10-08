import type { Aspect, AspectRow, Feature, FeatureRow, QuadrantPoint } from "@/lib/nps-data";
import type { FeatureKey } from "@/backend/contracts";
import { DEMO_FILTERS, loadDashboard } from "@/backend/synthetic/dashboardMetrics";

const FEATURE_LABEL: Record<string, Feature> = {
  lab_blood_parser: "Lab / Blood Report Parser",
  mri_imaging_insights: "MRI / Imaging Insights",
  symptom_chat_companion: "Symptom Chat Companion",
  gp_question_builder: "GP Question Builder",
};

const ASPECT_LABEL: Record<string, Aspect> = {
  clinical_trust: "Clinical Trust",
  tone_and_bedside_manner: "Tone & Bedside Manner",
  document_parsing_ocr: "Document Parsing / OCR Quality",
  actionability: "Actionability",
  billing_cost: "Billing / Cost",
  ui_confusion: "UI Confusion",
  response_speed: "Response Speed",
};

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function hours(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  const whole = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return `${whole}h ${minutes}m`;
}

function buildLive() {
  const data = loadDashboard(DEMO_FILTERS);
  const { executive, operations } = data;
  const nps = executive.nps;
  const trust = executive.medicalTrust;
  const headline = {
    nps: nps.overall.value,
    momDelta: nps.overall.delta ?? 0,
    relational: nps.relational.value,
    transactional: nps.transactional.value,
    responseRate: nps.responseRate.value,
    responseRateDelta: nps.responseRate.delta ?? 0,
    responses: executive.sample.responses,
    eligibleSurveys: executive.sample.eligibleSurveys,
    promoters: nps.distribution.promotersPct,
    passives: nps.distribution.passivesPct,
    detractors: nps.distribution.detractorsPct,
  };
  const medicalKpis = [
    {
      key: "ard",
      label: "Anxiety Reduction Delta",
      abbrev: "ARD",
      value: `${trust.anxietyReductionDelta.value.toFixed(1)}%`,
      target: "Target > 75% positive shift",
      status: trust.anxietyReductionDelta.status ?? "watch",
      delta: `${signed(trust.anxietyReductionDelta.delta ?? 0, 1)} pts MoM`,
      blurb: `${trust.anxietyReductionDelta.numerator?.toLocaleString()} of ${trust.anxietyReductionDelta.denominator?.toLocaleString()} valid pre/post pairs reported lower anxiety.`,
    },
    {
      key: "ccs",
      label: "Clinical Comprehension Score",
      abbrev: "CCS",
      value: `${trust.clinicalComprehensionScore.value.toFixed(1)}%`,
      target: "Target > 85%",
      status: trust.clinicalComprehensionScore.status ?? "watch",
      delta: `${signed(trust.clinicalComprehensionScore.delta ?? 0, 1)} pts MoM`,
      blurb: `${trust.clinicalComprehensionScore.numerator?.toLocaleString()} of ${trust.clinicalComprehensionScore.denominator?.toLocaleString()} lab and imaging answers were understood without a search.`,
    },
    {
      key: "hallucination",
      label: "Hallucination / Inaccuracy Flag Rate",
      abbrev: "HFR",
      value: `${trust.hallucinationFlagRate.value.toFixed(2)}%`,
      target: "Target < 0.20%",
      status: trust.hallucinationFlagRate.status ?? "alarm",
      delta: `${signed(trust.hallucinationFlagRate.delta ?? 0, 2)} pts MoM`,
      blurb: `${trust.hallucinationFlagRate.numerator?.toLocaleString()} mismatch sessions among ${trust.hallucinationFlagRate.denominator?.toLocaleString()} eligible clinical sessions. By model: ${executive.hallucinationByModel.map((row) => `${row.modelVersion} ${row.value.toFixed(2)}%`).join(", ")}.`,
    },
    {
      key: "disclaimer",
      label: "Disclaimer Fatigue Index",
      abbrev: "DFI",
      value: `${trust.disclaimerFatigueIndex.value.toFixed(1)}%`,
      target: "Target < 5%",
      status: trust.disclaimerFatigueIndex.status ?? "watch",
      delta: `${signed(trust.disclaimerFatigueIndex.delta ?? 0, 1)} pts MoM`,
      blurb: `${trust.disclaimerFatigueIndex.numerator?.toLocaleString()} of ${trust.disclaimerFatigueIndex.denominator?.toLocaleString()} disclaimer exposures were negative.`,
    },
  ] as const;
  const features: FeatureRow[] = data.features.map((row) => ({
    feature: FEATURE_LABEL[row.featureKey as FeatureKey] ?? (row.featureName as Feature),
    nps: row.nps,
    delta: row.monthOverMonthDelta ?? 0,
    responses: row.responseCount,
    promoters: row.distribution.promotersPct,
    passives: row.distribution.passivesPct,
    detractors: row.distribution.detractorsPct,
    topDriver: row.topDriver?.label ?? "—",
    safetyFlags: row.safetyFlagCount,
  }));
  const quadrant: QuadrantPoint[] = data.quadrant.map((point) => ({
    id: point.id,
    theme: point.theme,
    volume: point.volume,
    impact: point.netSentimentImpact,
    feature: FEATURE_LABEL[point.featureKey] ?? "Lab / Blood Report Parser",
    aspect: ASPECT_LABEL[point.aspect] ?? "Clinical Trust",
    critical: point.critical,
    note: point.note,
  }));
  const aspects: AspectRow[] = data.absa.map((row) => ({
    aspect: (ASPECT_LABEL[row.aspect] ?? row.aspect) as Aspect,
    mentions: row.mentions,
    positive: row.positivePct,
    negative: row.negativePct,
    clinical: row.category === "clinical",
  }));
  const medianDeltaMinutes =
    operations.medianSeconds !== null && operations.previousMedianSeconds !== null
      ? Math.round((operations.medianSeconds - operations.previousMedianSeconds) / 60)
      : null;
  return {
    headline,
    medicalKpis,
    trend: data.trend,
    features,
    quadrant,
    aspects,
    operations: {
      ...operations,
      medianLabel: hours(operations.medianSeconds),
      medianDeltaMinutes,
      openP0: operations.openP0,
      phiLeaks: operations.phiLeaks,
    },
  };
}

let cached: ReturnType<typeof buildLive> | null = null;

export function getLiveDashboard() {
  cached ??= buildLive();
  return cached;
}
