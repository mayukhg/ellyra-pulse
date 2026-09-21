# Synthetic dataset

Generated fixture data shaped like the canonical schema in `db/migrations/0001_init.sql` (§3 of
`docs/UI_INTEGRATION_REQUIREMENTS.md`), for local backend development, seeding the in-memory
store (`src/server/store.ts`), and frontend fixtures. No real user data — every row is
synthetically generated.

Regenerate with:

```bash
node scripts/generate-synthetic-data.mjs
```

The generator is deterministic (seeded PRNG), so re-running produces byte-identical output.
Edit `scripts/generate-synthetic-data.mjs` and re-run it rather than hand-editing the JSON files.

## Files

| File | Rows | Maps to |
|---|---:|---|
| `dim_feature_touchpoint.json` | 4 | `dim_feature_touchpoint` |
| `dim_user_cohort.json` | 4 | `dim_user_cohort` |
| `fact_nps_response.json` | 8,000 | `fact_nps_response` |
| `fact_closed_loop_ticket.json` | ~900 | `fact_closed_loop_ticket` (one per detractor/P0 response) |
| `response_processing_audit.json` | 8,000 | `response_processing_audit` |

Field names in the JSON are `snake_case` to match the SQL column names directly (for a future
`COPY ... FROM` / bulk-insert into Postgres). `src/server/fixtures.ts` maps them to the
`camelCase` shapes the in-memory store and API routes use.

## Shape notes

- Spans 2026-03-01 through 2026-09-21, one response per row, feature volume split
  32% / 16% / 38% / 14% across lab parser / imaging / chat / GP builder (matches the relative
  volumes in the prototype's original mock data, `src/lib/nps-data.ts`).
- Per-feature NPS lands close to the target figures already used across `docs/DESIGN.md` and the
  prototype (lab parser ~62, imaging ~48, chat ~50, GP builder ~69) — exact numbers vary slightly
  run to run only if you change the PRNG seed.
- ~0.25% of responses are safety-flagged (roughly the order of magnitude of the Hallucination /
  Inaccuracy Flag Rate target in `docs/DESIGN.md` §6.1), each with one reason code from
  `SAFETY_REASON_CODES` in `src/server/contracts.ts` and no other aspect tags (a safety case
  isn't also ABSA-tagged in this fixture — treat that as a simplification, not a modeling claim).
- `verbatim_redacted` already has PHI patterns (~18% DOB, ~15% name, ~6% MRN, ~5% email)
  redacted the same way `src/server/ingestion/redaction.ts` would — the pre-redaction raw text is
  not persisted anywhere, matching the "raw text never leaves the restricted boundary" rule in
  §9 of the integration spec.
- Tickets are pre-populated with a realistic status mix (~60% resolved, ~25% contacted, ~15%
  still open), some with an SLA breach timestamp, so the dashboard's closed-loop SLA metrics have
  something non-trivial to show.

## Loading it

```ts
import { loadSyntheticFixtures } from "@/server/fixtures";

loadSyntheticFixtures(); // populates the in-memory store (src/server/store.ts) for local dev
```

This is fixture data for development and demos — do not seed a production database from it.
