/**
 * Aggregation queries backing the executive, feature, quadrant, and ABSA reads.
 * Numbers come from the seeded quota corpus so the in-memory API matches the verifier.
 */
import type {
  AnalyticsFilters,
  AbsaRowDto,
  ExecutiveMetricsResponse,
  FeatureMetric,
  QuadrantPointDto,
} from "./contracts";
import { buildCorpus } from "./synthetic/buildCorpus";
import {
  corpusAbsa,
  corpusExecutive,
  corpusFeatures,
  corpusQuadrant,
} from "./synthetic/dashboardMetrics";

export function getExecutiveMetrics(filters: AnalyticsFilters): ExecutiveMetricsResponse {
  return corpusExecutive(buildCorpus(), filters);
}

export function getFeatureMetrics(filters: AnalyticsFilters): FeatureMetric[] {
  return corpusFeatures(buildCorpus(), filters);
}

export function getQuadrant(
  filters: AnalyticsFilters,
  minVolume: number,
  criticalOnly?: boolean,
): QuadrantPointDto[] {
  return corpusQuadrant(buildCorpus(), filters, minVolume, criticalOnly);
}

export function getAbsaRows(filters: AnalyticsFilters): AbsaRowDto[] {
  return corpusAbsa(buildCorpus(), filters);
}
