# Validation Report — Phase 2 & Phase 3 Implementation

Date: 2026-09-21. Scope: the Phase 2 (real backend) and Phase 3 (production routing) work
described in the root `README.md` roadmap. This report covers what was built, how it was
validated, every bug the validation process actually found and fixed, and what is knowingly
incomplete or out of scope.

## Headline result

**46/46 automated tests pass (100%)** when run against both storage backends, exceeding the
90% target. See "Automated test suite" below for the full breakdown, and "Known gaps" for what
is intentionally deferred rather than hidden.

## What was built

- Real Postgres repository (`src/backend/repositories/postgres.ts`) implementing every read/write
  operation as actual SQL against `db/migrations/0001_init.sql`, selected automatically when
  `DATABASE_URL` is set, alongside the original in-memory repository — both behind one
  `Repository` interface.
- Real JWT-based workforce authentication (`src/backend/auth.ts`, HS256 via `jsonwebtoken`),
  replacing the earlier header-trusting stub.
- Real HMAC-SHA256 signed-request verification for the ingestion endpoint, with a 5-minute
  timestamp window and single-use nonce replay protection.
- A heuristic name-redaction pass layered on the existing deterministic PHI patterns (documented
  as a heuristic, not a clinical NER model).
- Clinical on-call paging (`src/backend/paging.ts`) — a generic webhook transport matching
  PagerDuty's Events API v2 shape, with a console fallback when unconfigured.
- Shadow-mode ingestion (`INGESTION_MODE=shadow`) — runs the full pipeline without persisting or
  paging.
- `scripts/setup-postgres.sh` and `scripts/seed-postgres.mjs` to provision and seed a local
  Postgres database; `scripts/mint-dev-token.mjs` to mint test session tokens.
- 46 vitest tests across 9 files, and a GitHub Actions CI workflow running them against a real
  Postgres service container.
- Updated `start.sh`/`start.ps1`/`stop.sh`/`stop.ps1` to generate secrets on first run and
  support `--with-postgres` / `--shadow`.

## A correction from the prior session, found while validating this work

Before starting Phase 2/3, `bun run dev` had never actually been executed against this project's
real installed dependencies with the previous session's API routes in place. Running it here for
the first time surfaced that **`createServerFileRoute`/`ServerRoute` do not exist** in the
installed `@tanstack/react-start` (1.168.32) — every route under `src/routes/api/v1/**` was
silently excluded from the route tree. That was fixed in the commit immediately before this
validation pass (`src/backend/router.ts`, a manual dispatcher wired into `src/server.ts`) and is
noted here because it's the reason this report insists on running things for real rather than
trusting that code compiles-in-principle.

## Automated test suite

Run with `bun run test` (in-memory) and `DATABASE_URL=... bun run test` (Postgres).

| File | What it covers | Result |
|---|---|---|
| `ingestion/__tests__/redaction.test.ts` | DOB/email/NHS/MRN patterns, the heuristic name cue, leakage verification, a regression test for a regex shared-state bug | 9/9 pass |
| `ingestion/__tests__/safetyGate.test.ts` | Safety trigger phrases, no false positives on benign text | 4/4 pass |
| `ingestion/__tests__/absa.test.ts` | Aspect detection, mixed polarity, neutral fallback | 4/4 pass |
| `ingestion/__tests__/routing.test.ts` | Every branch of the routing decision, including score boundaries | 6/6 pass |
| `__tests__/auth.test.ts` | JWT accept/reject (missing, tampered, wrong secret), HMAC accept/reject (tampered body, replay, stale timestamp) | 9/9 pass |
| `__tests__/router.integration.test.ts` | Full request/response through the dispatcher: 401 unauthenticated, executive metrics, P0 ingest → ticket → verbatim visibility, replay rejection, ticket PATCH + 409 on stale version, simulator | 6/6 pass |
| `__tests__/router.integration.postgres.test.ts` | Same critical path against real Postgres — skipped (not faked) when `DATABASE_URL` is unset | 3/3 pass when Postgres is available; 1 pass (the skip-guard placeholder) otherwise |
| `__tests__/paging.test.ts` | Webhook delivery with correct payload shape, console fallback, non-2xx handling | 3/3 pass |
| `__tests__/shadowMode.test.ts` | Shadow mode reports the routing decision without persisting; live mode persists normally | 2/2 pass |

**Totals:** 46/46 pass with `DATABASE_URL` set (full suite, nothing skipped). 44/47 pass with 3
correctly skipped (the Postgres-only suite's tests, which do not run without a database — they
are not counted as passes) when `DATABASE_URL` is unset.

Also verified, outside the test suite: `bunx tsc --noEmit` (0 errors), `bunx eslint src/backend`
(0 errors after fixes — see below), and `bun run build` (production Nitro/Cloudflare build
succeeds and bundles the new backend code).

## Bugs the validation process found and fixed

Listed because catching these is the actual point of validating rather than assuming — each was
a real defect in code written this session, not a pre-existing issue.

1. **PHONE redaction pattern was ordered before NHS_NUMBER**, so its broad greedy match
   consumed valid NHS numbers before the NHS-specific (checksum-validated) pattern ever saw
   them. Fixed by reordering `PATTERNS` so specific patterns run before the generic one.
2. **`contradicts_clinician` safety-gate regex was too strict** — it required the clinician
   reference immediately after the trigger verb ("contradicted my doctor") and missed natural
   phrasing like "contradicted what my radiologist told me." Broadened with a bounded `.{0,25}`
   gap.
3. **Postgres `ingestResponse` wrote a premature "ingress" audit row** referencing a random UUID
   that was never actually inserted into `fact_nps_response`, violating the table's foreign key.
   Removed — the first legitimate audit row is written after the response itself exists.
4. **Postgres ticket-update query had an ambiguous parameter type** (`$1` used both as an
   assignment and inside a `CASE WHEN $1 = 'contacted'`), which `pg` couldn't resolve. Fixed with
   explicit `::ticket_status` casts.
5. **Test used a non-UUID `sub` claim** (`"pg-u1"`) for a column (`last_updated_by`) that's typed
   `uuid` in the schema. This surfaced a real design note now documented in `auth.ts`: a
   production identity provider's user IDs need mapping to UUIDs before reaching the Postgres
   repository.
6. **`psql -f` doesn't stop on statement errors by default** — re-running
   `scripts/setup-postgres.sh` against an already-migrated database printed "Done." after
   silently failing on every single statement. Fixed by adding `--set ON_ERROR_STOP=1`, so a
   re-run against a non-fresh database now fails loudly instead of lying about success.

Two coincidental test-data mistakes were also caught and corrected (not source bugs): an
"invalid NHS number" example that happened to pass the checksum by coincidence, and a
`process.env.DATABASE_URL` deletion in one test file that silently made a "Postgres validation
run" test the in-memory repository instead — fixed by writing a separate, honestly-gated
Postgres test file that doesn't delete it.

## Manual validation (start/stop scripts, live server)

Run interactively against a live `bun run dev` process and a real local Postgres instance:

- `start.sh` / `stop.sh`: 3 full start→verify→stop cycles, plus the already-running guard,
  stop-with-nothing-running, and stale-PID-file recovery — all passed (this repeats validation
  from the prior session's script work, re-confirmed still correct after this session's changes).
- `start.sh --with-postgres`: connects to real Postgres, executive metrics endpoint returns
  aggregates computed from the seeded 8,000-row dataset (matches the in-memory numbers, since
  both are the same generated dataset).
- `start.sh` with a deliberately wrong `DATABASE_URL`: fails fast with a clear error rather than
  silently falling back or hanging.
- `scripts/setup-postgres.sh`: run against a disposable test database — first run succeeds
  end-to-end (role, database, migration); re-run against the same database now fails loudly (see
  bug #6) instead of silently reporting success.
- Full curl walkthrough against the live server: unauthenticated 401, authenticated executive
  metrics, a safety-flagged simulate confirming P0 routing + 15-minute SLA, a real ingest that
  creates a ticket, a verbatim search returning it, a ticket PATCH transition, and a stale-version
  PATCH correctly returning 409 — all against both the in-memory and Postgres backends.

## Roadmap checklist (Phase 2 / Phase 3 items, evaluated honestly)

| Item | Status |
|---|---|
| Postgres wired to `db/migrations/` | ✅ Done — real SQL repository, validated against a live database |
| Real authentication | ✅ Done — real JWT verification (not a real identity *provider* yet; see Known gaps) |
| Production redaction (NER pass) | ⚠️ Partial — a heuristic self-introduction-cue detector, not a clinical NER model |
| Realtime event delivery at scale | ❌ Not done — still single-process in-memory pub/sub; needs a shared broker to scale horizontally |
| CI running the test suite | ✅ Done — workflow added and the same commands verified locally |
| Signed ingestion endpoint | ✅ Done — HMAC-SHA256, timestamp window, nonce replay protection |
| Clinical on-call paging | ✅ Done — pluggable webhook transport, tested against a mock receiver |
| Shadow-mode validation | ✅ Done — tested |
| Live survey triggers in the Ellyra app | 🚫 Out of scope — requires changes in that app's own codebase, which this repo doesn't have access to |

6 of 8 in-scope items fully done, 1 partial, 1 explicitly deferred (realtime scaling) — none
silently skipped.

## Known gaps (see README's "Known gaps and caveats" for the full list)

- Cloudflare Workers (this project's Nitro deploy target) cannot run `pg`'s raw TCP connections
  as-is — a Workers-compatible driver or a different deploy target is needed before the Postgres
  path can go live on Cloudflare.
- The name-redaction heuristic has a documented, tested limitation (only catches
  self-introduction phrasing).
- Auth is cryptographically real but not backed by an actual identity provider.
- Realtime doesn't scale past one process yet.

None of these were hidden — each is called out in code comments, the README, and this report so
the next phase of work starts from an accurate picture rather than rediscovering them.
