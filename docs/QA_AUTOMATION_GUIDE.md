# QA Automation Guide

For an automated QA agent building validation workflows against this app. Read this alongside
`docs/DESIGN_UI.md` (the full API/data-model spec) and `docs/workflow.md` (the pipeline diagram)
— this document tells you what to test and how to reach it; those tell you why it behaves that
way.

## What this app is

Ellyra Pulse ingests NPS/CSAT feedback for a B2C medical AI product, redacts PHI, classifies
sentiment and safety risk, routes the result (clinical page, support ticket, review prompt, or a
micro-poll), and exposes the aggregate as a dashboard. See the root `README.md` for the product
framing. The two things that make this different from a generic feedback tool, and that your
tests should weight accordingly:

1. **Safety routing must never be bypassed by a good NPS score.** A 10/10 response containing
   self-harm language must still page clinical on-call.
2. **PHI must never reach the API surface.** Every text field the API returns is redacted; raw
   text must never appear in a response body, log, or realtime event.

## How to bring the app up for testing

```sh
./start.sh                    # in-memory store, seeded from data/synthetic/ (8,000 rows)
./start.sh --with-postgres    # real Postgres — run scripts/setup-postgres.sh first
./start.sh --shadow           # ingestion evaluates but never persists or pages
```

The app listens on `http://127.0.0.1:5173` (override with `--host`/`--port`). `./stop.sh` tears
it down. See `README.md`'s "How to bring up the app" section for the full flag list.

**Auth**: every endpoint except `/api/v1/responses/ingest` requires `Authorization: Bearer
<JWT>`. Mint a test token:

```sh
source .env   # written by start.sh on first run — has AUTH_JWT_SECRET
TOKEN=$(AUTH_JWT_SECRET=$AUTH_JWT_SECRET node scripts/mint-dev-token.mjs <role> <userId> <tenantId>)
```

Roles: `dashboard_viewer`, `customer_success`, `clinical_safety`, `administrator` (roles other
than `administrator` gate specific endpoints — see the matrix below).

**Ingestion auth is different**: `/api/v1/responses/ingest` requires an HMAC-SHA256 signature,
not a bearer token — see "Signing an ingest request" below.

## Endpoint reference

All under `/api/v1`. Full request/response shapes are in `docs/DESIGN_UI.md` §4–§5; this table
is the quick-reference for building test cases.

| Method | Path | Auth | Notes for testing |
|---|---|---|---|
| GET | `/metrics/executive` | any role | Query: `from`, `to` (YYYY-MM-DD), optional `feature`, `cohort`, `aspect`, `surveyType` |
| GET | `/metrics/features` | any role | Same filters; returns one row per feature touchpoint |
| GET | `/analysis/quadrant` | any role | Adds `minVolume`, `criticalOnly`; critical points bypass `minVolume` |
| GET | `/analysis/absa` | any role | Aspect sentiment breakdown |
| GET | `/verbatims` | any role, but response differs by role | `clinical_safety`/`administrator` see real safety reason codes and session refs; other roles get them nulled/emptied — **this is a security boundary, test it explicitly** |
| POST | `/workflow/simulate` | any role | Sandbox — runs the pipeline, never persists. Safe to fuzz freely |
| POST | `/responses/ingest` | HMAC signature, not JWT | Persists (unless shadow mode). See signing instructions below |
| PATCH | `/tickets/:id` | `customer_success` or `clinical_safety` | Requires current `version`; stale version → `409` |
| GET | `/realtime/events` | any role | SSE stream; text payloads are identifiers/status only, never verbatim text |

### Signing an ingest request

```sh
source .env
BODY='{"sourceSystem":"qa-agent","externalResponseId":"qa-001","surveyType":"transactional","score":3,"featureKey":"lab_blood_parser","channel":"in_app","rawText":"..."}'
TS=$(node -e "console.log(Date.now())")
NONCE="qa-$(date +%s)-$RANDOM"
SIG=$(node -e "console.log(require('crypto').createHmac('sha256', process.env.INGEST_HMAC_SECRET).update('$TS.$NONCE.'+process.argv[1]).digest('hex'))" "$BODY")

curl -X POST http://127.0.0.1:5173/api/v1/responses/ingest \
  -H "content-type: application/json" \
  -H "x-ingest-signature: $SIG" \
  -H "x-ingest-source-system: qa-agent" \
  -H "x-ingest-timestamp: $TS" \
  -H "x-ingest-nonce: $NONCE" \
  -d "$BODY"
```

A nonce can only be used once; replaying the exact same headers+body must return `401`.

## Feature keys, aspects, and reason codes (for building test inputs)

- **Feature keys**: `lab_blood_parser`, `mri_imaging_insights`, `symptom_chat_companion`,
  `gp_question_builder`.
- **ABSA aspects**: `clinical_trust`, `tone_and_bedside_manner`, `document_parsing_ocr`,
  `actionability` (clinical), `billing_cost`, `ui_confusion`, `response_speed` (operational).
- **Safety reason codes**: `ocr_unit_mismatch`, `missed_abnormal_marker`,
  `contradicts_clinician`, `false_reassurance`, `urgent_symptom_minimisation`,
  `self_harm_or_emergency`, `medication_danger`. Trigger phrases are in
  `src/backend/ingestion/safetyGate.ts`.

## Priority test scenarios

Ranked by what actually matters for this product — safety and privacy first.

### P0 — safety routing (must never regress)

1. Ingest text containing a safety trigger phrase (e.g. "I mentioned feeling like I might
   self-harm") with **any** score, including 9 or 10. Assert: `route_action` /
   `wouldRoute` = `p0_clinical_page`, a ticket with `priority: p0` and a 15-minute SLA is
   created (or, in shadow mode, nothing is persisted but `wouldRoute` still reports it).
2. Confirm a positive score alone (no trigger phrase) never produces a P0 route.
3. Confirm the paging call fires for a real P0 ingest — point `PAGER_WEBHOOK_URL` at a mock
   receiver and assert it received a POST with the response's reason codes.

### P0 — PHI never leaks

1. Ingest raw text containing a DOB, email, phone, NHS number (checksum-valid), MRN pattern, or
   a self-introduced name ("Hi, this is Jordan Ellis"). Fetch it back via `/verbatims` and assert
   the raw value never appears in `text` — only `[REDACTED_*]` tags.
2. Send text where the deterministic scrubber would plausibly miss something (adversarial
   phrasing, unusual formatting) and confirm the response is either cleanly redacted or
   quarantined (`processingStatus: "failed"`) — never returned with a leak.
3. Confirm `/verbatims` never returns a `verbatim_ciphertext_ref`-equivalent or raw session
   identifier to a `dashboard_viewer` role.

### P1 — routing correctness (non-safety)

Exercise the full score range against `/workflow/simulate` (no persistence needed):
0–6 → `cs_ticket`; 7–8 → `micro_poll`; 9–10 → `review_prompt`. Boundary-test 6 vs. 7, 8 vs. 9.

### P1 — ticket state machine

1. Valid transitions succeed: `open→contacted`, `contacted→resolved`, `open→escalated`, etc. —
   see `src/backend/ticketRules.ts` for the full table.
2. Invalid transitions (e.g. `open→resolved` directly) return `422`.
3. A stale `version` in the PATCH body returns `409`, and the ticket is unchanged.
4. Resolving a `p0_clinical` ticket without `resolutionCode` returns `422`.
5. Reopening a `resolved` ticket requires `administrator` role and a `reason`; other roles get
   `422`/`400` appropriately.

### P1 — idempotency and replay

1. Ingesting the same `(sourceSystem, externalResponseId)` pair twice returns the same
   `responseId` both times, without creating a duplicate ticket.
2. Replaying an ingest request's exact signature+nonce returns `401`.
3. An ingest request with a timestamp more than 5 minutes old returns `401`.

### P2 — aggregate correctness

Ingest a known batch of responses (fixed scores/features/aspects) and verify
`/metrics/executive` and `/metrics/features` compute NPS as `%promoters − %detractors` exactly,
and that `/analysis/quadrant`'s `critical` flag only ever appears for volume < 300 AND clinical
aspects.

### P2 — cross-backend parity

If both backends are reachable, run the same scenario against `--with-postgres` and without it;
results should match in shape (exact numbers will differ since they're separate datasets unless
you seed both identically).

## What "done" looks like for a test run

A response's shape should always match `docs/DESIGN_UI.md` §4's TypeScript contracts
(`src/backend/contracts.ts` is the source of truth if the two ever disagree — it's the one the
code actually validates against). Error responses always follow the `ApiError` envelope with a
`requestId`. See `docs/VALIDATION_REPORT.md` for this project's own baseline validation run and
current pass rate, and `src/backend/**/__tests__/` for the existing automated suite (`bun run
test`) — new QA workflows should extend that suite rather than duplicate it where possible.
