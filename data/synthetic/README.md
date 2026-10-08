# Synthetic dataset

Quota-built fixture data for local development and Postgres seeding. No real user data.
The source of truth is `src/backend/synthetic/buildCorpus.ts`. Identifiers come from the seed
(`20260921`), so a second run is the same corpus.

The in-memory API builds that corpus in process. Postgres does not. Generate the JSONL, then seed:

```bash
bun scripts/generate-synthetic-data.mjs
bun scripts/verify-synthetic-quotas.ts
DATABASE_URL=postgres://ellyra:ellyra_dev_pw@127.0.0.1:5432/ellyra_pulse bun scripts/seed-postgres.mjs
```

`data/synthetic/generated/` is gitignored. Apply `db/migrations/0001_init.sql`,
`db/migrations/0002_synthetic_metrics.sql`, `db/migrations/0003_telemetry_cohort.sql`, and
`db/migrations/0004_session_model_version.sql`
before seeding (`scripts/setup-postgres.sh` does all four on a fresh database).

Edit the quotas in `src/backend/synthetic/quotas.ts` rather than the JSONL. The verifier exits
non-zero when a published rate misses. Headline counts are assigned, not drawn with `Math.random`.
Formulas and the demo scorecard figures are in `docs/METRICS.md`. This corpus is not a model eval
(`docs/EVALS.md`).

Every clinical session is stamped `ellyra-core-2026.5` (`model_version`). The hallucination rate
for that single version matches the headline rate.

## What the corpus contains

Seven windows from 1 Mar 2026 through 21 Sep 2026. The demo window is 22 Aug–21 Sep. The prior
window is 23 Jul–22 Aug.

| Fact | Demo window | Role |
|---|---:|---|
| NPS responses | 2,400 | Verbatims, NPS +57, relational +52, transactional +61 |
| Eligible invitations | 10,084 | Response rate 23.8% |
| Eligible clinical sessions | 12,903 | Hallucination rate 0.31% (40 mismatch flags) |
| Valid anxiety pairs | 1,000 | Anxiety reduction 78.4% |
| Report comprehension answers | 1,000 | Clinical comprehension 82.6%, lab and imaging only |
| Disclaimer-exposed responses | 1,200 | Disclaimer fatigue 6.8% |

The prior window carries the previous targets (NPS +53, response rate 22.2%, hallucination 0.22%,
close rate 68%). Earlier months exist so a trend has somewhere to go. Full corpus is about
13,600 responses, 59,000 eligible invitations, and 87,000 clinical sessions.

Raw identifiers are not written. Quarantine rows store `residual_mrn_pattern` and nothing else.
Twelve of those sit in each window and are excluded from `fact_nps_response`.

Do not seed a production database from this corpus.
