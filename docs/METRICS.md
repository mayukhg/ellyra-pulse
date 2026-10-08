# Metrics

How the dashboard numbers are computed. The product targets still live in `docs/DESIGN.md` §6 and `docs/DESIGN_UI.md` §5. This file is the implemented contract. The code is `src/backend/synthetic/dashboardMetrics.ts`. The demo UI reads it through `src/lib/live-dashboard.ts`.

The quota corpus (`src/backend/synthetic/quotas.ts`, seed `20260921`) is the dataset. It is not a model evaluation. See `docs/EVALS.md` for that.

## Where a number comes from

| Surface | Source |
|---|---|
| Scorecard, feature table, quadrant, ABSA explorer, closed-loop stats, header chips | `getLiveDashboard()` over the in-memory corpus |
| `GET /api/v1/metrics/executive` and the other metric routes | The same corpus when `DATABASE_URL` is unset. Postgres SQL when it is set |
| Verbatim cards | The 12 fixtures in `src/lib/nps-data.ts`. A quadrant click filters those fixtures. It does not list corpus verbatims |

Windows are half-open on the UTC date: `from <= day < to`. The demo filters run from 22 Aug 2026 until 21 Sep 2026, so the last included day is 20 Sep. The comparison window runs from 23 Jul 2026 until 22 Aug 2026, so the last included day is 21 Aug. The chart's Aug and Sep labels are those two windows, not calendar months. Mar–Jul are the earlier quota buckets.

Percentages are points (`78.4`, not `0.784`). Durations are seconds. NPS is an integer.

## Headline NPS

`npsOf` rounds one-decimal promoter and detractor shares, then rounds their difference:

```
round(round(promoters / n, 1 digit) − round(detractors / n, 1 digit))
```

Relational and transactional scores use the same formula on their own rows. Demo window: overall +57, relational +52, transactional +61, previous window +53 / +50 / +55. Distribution is 68% / 21% / 11% (1,632 / 504 / 264 of 2,400).

Response rate is completed responses divided by eligible invitations, not by the responses themselves. Ineligible invitations stay out of the denominator. Demo: 2,400 / 10,084 = 23.8%, previous 2,200 / 9,910 = 22.2%.

Feature NPS uses the same formula inside the selected window. Month-over-month is against the previous equal-length window. Demo volumes are lab 768, imaging 384, chat 912, GP question builder 336.

## Trust KPIs

| Metric | Numerator | Denominator | Healthy | Watch | Alarm |
|---|---|---|---|---|---|
| Anxiety reduction (ARD) | Pairs with post-score lower than pre-score | Valid anxiety pairs. Incomplete pairs are excluded | > 75 | ≥ 70 | below 70 |
| Clinical comprehension (CCS) | Understood without a search | Lab and imaging answers only | > 85 | ≥ 80 | below 80 |
| Hallucination flag rate | Eligible clinical sessions whose mismatch codes overlap the four mismatch codes | Eligible clinical sessions. GP question builder is not clinical | < 0.20 | none | ≥ 0.20 |
| Disclaimer fatigue (DFI) | Exposed responses with disclaimer polarity below 0 | Disclaimer-exposed responses | < 5 | ≤ 8 | above 8 |

Mismatch codes, and only these, count toward the hallucination rate: `contradicts_clinician`, `ocr_unit_mismatch`, `missed_abnormal_marker`, `false_reassurance`.

Harm codes are P0 and are not in that rate: `self_harm_or_emergency`, `medication_danger`, `urgent_symptom_minimisation`.

Demo window: ARD 784/1,000 = 78.4 healthy, CCS 826/1,000 = 82.6 watch, hallucination 40/12,903 = 0.31 alarm, DFI 82/1,200 = 6.8 watch. The previous window's hallucination rate is 30/13,636 = 0.22.

The hallucination card alarms at 0.20%. That alarm does not send a page. Paging is per response, from the routing engine, when `PAGER_WEBHOOK_URL` is set.

### By serving model

Each clinical session stores `model_version` (`db/migrations/0004_session_model_version.sql`). `hallucinationByModel` repeats the hallucination formula inside each version present in the window. The synthetic corpus stamps every session `ellyra-core-2026.5`, so the demo slice is one row and matches the headline 0.31%. A second Gemini version in the same window shows up as its own row instead of disappearing into the average.

## Closed loop

Median time to first contact is the contact delay at index `floor(n / 2)` of the sorted delays (upper middle). Postgres uses the same index, not `percentile_cont`. Demo median is 11,880 seconds (3h 18m), 42 minutes faster than the previous window.

Close rate is tickets resolved divided by tickets created in the window. Demo 231/312 = 74.0%, previous 219/322 = 68.0%.

P0 within 15 minutes is 43/48 = 89.6%. Detractor contact within 24 hours is 211/264 = 80%. Open P0 count is tickets still `open` with priority P0 (3 in the demo window). Page failures are the first two of those open tickets.

Persisted PHI leakage-scan failures in the demo window: 0. Quarantine rows in the window: 12, reason `residual_mrn_pattern` only.

## Quadrant and ABSA

Net sentiment impact is the sum of aspect polarity in the window. Polarity on this corpus is only −1, 0, or +1, because the tagger is `lexicon-absa-v1`.

A theme is critical when `fact_theme_override.critical` is true. Volume does not clear that flag. Critical themes stay on the chart below the 300-mention floor.

The chart's high-impact line is `|sum of polarity| >= volume × 0.4`. High volume is 300 mentions. The Y axis is padded from the data. The tooltip states the sum.

ABSA rows are mention counts and positive / neutral / negative shares for the seven taxonomy keys. The explorer is not filtered by the selected feature. The quadrant is.

## Telemetry

Frustration and the survey funnel describe the whole telemetry sample (2,000 sessions). They are not cut by the date window.

A session is frustrated when it has a rage click or a dead click. Bands: under 15% healthy, at or above 15% amber, at or above 30% red. Demo: overall 440/2,000 = 22% amber, desktop 136/1,240 = 11% healthy, mobile 185/560 = 33% red, tablet 119/200 = 59.5% red.

Completions are 476 (23.8%), split desktop 295, mobile 133, tablet 48, then split across the four cohorts. Every session has the first four funnel events, so the only drop is at completion. Cohort keys: `new_lt_30d`, `established_30_180d`, `tenured_gt_180d`, `premium_active`.

## Checks

```bash
bun scripts/verify-synthetic-quotas.ts
bun run test
```

`src/backend/synthetic/__tests__/dashboardMetrics.test.ts` locks the demo figures above.
