import { describe, expect, it } from "vitest";
import { buildCorpus } from "../buildCorpus";
import {
  DEMO_FILTERS,
  corpusExecutive,
  corpusOperations,
  corpusQuadrant,
  loadDashboard,
} from "../dashboardMetrics";

describe("dashboard metrics from the quota corpus", () => {
  const corpus = buildCorpus();
  const executive = corpusExecutive(corpus, DEMO_FILTERS);
  const operations = corpusOperations(corpus, DEMO_FILTERS);

  it("measures the demo window trust KPIs, NPS, and closed loop", () => {
    expect(executive.nps.overall).toMatchObject({ value: 57, previousValue: 53, delta: 4 });
    expect(executive.nps.relational.value).toBe(52);
    expect(executive.nps.transactional.value).toBe(61);
    expect(executive.nps.distribution).toMatchObject({
      promotersPct: 68,
      passivesPct: 21,
      detractorsPct: 11,
    });
    expect(executive.nps.responseRate).toMatchObject({
      value: 23.8,
      previousValue: 22.2,
      delta: 1.6,
      numerator: 2400,
      denominator: 10084,
    });
    expect(executive.medicalTrust.anxietyReductionDelta).toMatchObject({
      value: 78.4,
      previousValue: 76.3,
      delta: 2.1,
      status: "healthy",
      numerator: 784,
      denominator: 1000,
    });
    expect(executive.medicalTrust.clinicalComprehensionScore).toMatchObject({
      value: 82.6,
      previousValue: 83.4,
      delta: -0.8,
      status: "watch",
    });
    expect(executive.medicalTrust.hallucinationFlagRate).toMatchObject({
      value: 0.31,
      previousValue: 0.22,
      delta: 0.09,
      status: "alarm",
      numerator: 40,
      denominator: 12903,
    });
    expect(executive.medicalTrust.disclaimerFatigueIndex).toMatchObject({
      value: 6.8,
      previousValue: 5.6,
      delta: 1.2,
      status: "watch",
    });
    expect(executive.closedLoop).toMatchObject({
      medianTimeToFirstContactSeconds: 11880,
      openP0Count: 3,
    });
    expect(executive.closedLoop.closeRate).toMatchObject({
      value: 74,
      previousValue: 68,
      delta: 6,
    });
    expect(operations.p0OnTime).toBe(43);
    expect(operations.p0Count).toBe(48);
    expect(operations.detractorWithin24Pct).toBe(80);
    expect(operations.phiLeaks).toBe(0);
    expect(operations.quarantines).toBe(12);
    expect(operations.frustration).toMatchObject({ overall: 22, desktop: 11, mobile: 33 });
    expect(operations.funnelCompletion).toBe(23.8);
    expect(operations.funnelByCohort).toHaveLength(4);
    expect(operations.funnelByCohort.every((cohort) => cohort.steps[0]?.count === 500)).toBe(true);
    expect(
      operations.funnelByCohort.every((cohort) => {
        const started = cohort.steps[0]?.count ?? 0;
        const completed = cohort.steps.at(-1)?.count ?? 0;
        return completed > 0 && completed < started;
      }),
    ).toBe(true);
    const completedByDevice = {
      desktop: corpus.telemetry.filter(
        (session) => session.device === "desktop" && session.events.includes("survey_completed"),
      ).length,
      mobile: corpus.telemetry.filter(
        (session) => session.device === "mobile" && session.events.includes("survey_completed"),
      ).length,
      tablet: corpus.telemetry.filter(
        (session) => session.device === "tablet" && session.events.includes("survey_completed"),
      ).length,
    };
    expect(completedByDevice).toEqual({ desktop: 295, mobile: 133, tablet: 48 });
  });

  it("keeps critical theme pins on the quadrant", () => {
    const points = corpusQuadrant(corpus, DEMO_FILTERS, 0);
    const critical = points.filter((point) => point.critical).map((point) => point.id);
    expect(critical).toEqual(
      expect.arrayContaining([
        "lab_blood_parser:document_parsing_ocr",
        "lab_blood_parser:clinical_trust",
        "symptom_chat_companion:clinical_trust",
      ]),
    );
    expect(points.find((point) => point.id === "gp_question_builder:billing_cost")?.critical).toBe(
      false,
    );
    expect(
      points.find((point) => point.id === "lab_blood_parser:document_parsing_ocr")
        ?.netSentimentImpact,
    ).toBe(-40);
  });

  it("keeps a critical pin after the theme reaches 300 mentions", () => {
    const grown = structuredClone(corpus);
    const added = grown.responses.filter(
      (row) =>
        row.bucketId === "demo" &&
        row.featureKey === "lab_blood_parser" &&
        !row.aspects.some((aspect) => aspect.aspect === "document_parsing_ocr"),
    );
    for (const row of added.slice(0, 260)) {
      row.aspects.push({ aspect: "document_parsing_ocr", polarity: -1, confidence: 0.9 });
    }
    const point = corpusQuadrant(grown, DEMO_FILTERS, 0).find(
      (item) => item.id === "lab_blood_parser:document_parsing_ocr",
    );
    expect(point?.volume).toBe(300);
    expect(point?.critical).toBe(true);
  });

  it("builds the scorecard view from the same demo window", () => {
    const view = loadDashboard(DEMO_FILTERS);
    expect(view.trend.map((point) => point.period)).toEqual([
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
    ]);
    expect(view.trend.at(-1)).toMatchObject({ relational: 52, transactional: 61 });
    expect(view.features.reduce((sum, row) => sum + row.responseCount, 0)).toBe(2400);
  });
});
