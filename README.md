# Ellyra Pulse

NPS and sentiment intelligence for [Ellyra Health](https://ellyra.health/)'s medical AI
companion — safety-gated feedback routing, PHI-safe redaction, and a clinical-trust dashboard.

---

## Problem statement

Ellyra Health is a B2C medical AI companion — lab and blood report interpretation, imaging
insight summaries, symptom-guidance chat, and GP-visit preparation. Every one of those
interactions happens at a moment of real anxiety: someone reading their own bloodwork, waiting
on what a scan means, trying to describe symptoms they don't have the vocabulary for.

For a product like this, customer sentiment is not a standard growth metric. A dip in NPS can
mean three very different things — a UI annoyance, a tone problem, or an AI response that
actively damaged someone's trust in their own care decisions — and today those three look
identical in a single aggregate score. Meanwhile the feedback itself is a compliance liability:
free-text NPS responses from this product routinely contain PHI, and a small number of them
describe a genuine safety failure (a missed abnormal marker, a misread decimal point, a
contradiction with a clinician) that has to reach a human within minutes, not at the end of a
weekly report.

**The problem, concretely:** Ellyra has no system today that (a) safely captures this feedback
without asking for it at the wrong moment, (b) tells detractor volume apart from detractor
*severity*, (c) routes a genuine safety signal to clinical review before it's just one more row
in a dashboard, and (d) gives product, clinical, and exec stakeholders a shared, trustworthy view
of what "sentiment" means for a medical AI product specifically.

## Vision

**Sentiment as a clinical-trust instrument, not a growth metric.** Ellyra Pulse should let the
team answer, at any time and with evidence: *do our users trust what the AI tells them, and do
we know within minutes when that trust is broken?*

That means:
- Feedback capture that respects the moment it's asked in — never competing with an emergency
  banner, never asking a generic question when a feature-specific one would tell us more.
- Analysis that separates *how many people are unhappy* from *how badly this specific failure
  could hurt someone* — a rare OCR misread on a blood panel matters more than a thousand
  complaints about button placement.
- A closed loop that is fast by default for anything safety-adjacent, and transparent everywhere
  else — every detractor gets a human response, every safety flag gets a clinical one.
- One dashboard that clinical, product, and support teams all trust, instead of three teams
  reading the same NPS number three different ways.

## Strategy

Three commitments carry the vision into the system design in `docs/DESIGN.md` and
`docs/DESIGN_UI.md`:

1. **Safety gates the pipeline, not the other way around.** The clinical risk filter runs
   *before* any survey trigger and before any routing decision — a safety signal is never
   downstream of an NPS score. See `docs/workflow.md` for the exact sequencing.
2. **Redaction is a pipeline stage, not a policy document.** PHI redaction and leakage
   verification happen in code, before storage or any model call, with an append-only audit
   trail — not as a promise layered on top of an existing analytics pipeline.
3. **Build the skeleton first, then the judgment.** The synthesis in `docs/DESIGN_COMPARISON.md`
   is the strategic call here explicitly: ship the schema, the routing engine, and a working
   dashboard before layering in deeper clinical-nuance analysis (root-cause quadrants, driver
   analysis, cross-period correlation) — each phase below is buildable and demoable on its own.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **Phase 0 — Design** | NPS/sentiment system design (`docs/DESIGN.md`), UI integration spec (`docs/DESIGN_UI.md`), design synthesis (`docs/DESIGN_COMPARISON.md`) | ✅ Done |
| **Phase 1 — Prototype UI + backend scaffold** | Interactive dashboard prototype (Lovable), canonical DB schema, ingestion pipeline logic, all 8 API endpoints against an in-memory store, synthetic dataset | ✅ Done (see Current Implementation) |
| **Phase 2 — Real backend** | Postgres wired to the migrations in `db/migrations/`, real JWT authentication, a heuristic name-redaction pass, CI running the redaction/safety/contract tests | ✅ Done, with caveats — see Current Implementation |
| **Phase 3 — Production routing** | Signed (HMAC) ingestion endpoint, clinical on-call paging, shadow-mode validation | ✅ Done as a pluggable mechanism — see caveats below. **Live survey triggers in the Ellyra app are out of scope**: they require integration in that app's own codebase, not this repo |
| **Phase 4 — Deep-dive analysis** | Root-cause quadrant analysis, driver analysis (SHAP), outcome correlation (retention, repeat usage), monthly ABSA taxonomy re-clustering | ⏳ Not started |

## Current implementation

**Prototype UI** (`src/routes/`, `src/components/nps/`) — a Lovable-built React/TanStack Start
app with mock data (`src/lib/nps-data.ts`) rendering the executive scorecard, feature-level NPS
table, root-cause quadrant, ABSA explorer, verbatim/closed-loop hub, and a workflow simulator.
Not yet wired to the backend below.

**Backend** (`src/backend/`):
- `contracts.ts`: shared TypeScript types and zod validation schemas for every request/response.
- `ingestion/`: redaction (deterministic pattern matching + a heuristic self-introduction name
  detector + leakage scan), the clinical safety gate, an ABSA classifier, and the routing
  engine — each a standalone, testable module.
- `pipeline.ts`: orchestrates those stages in the required order for both the sandbox simulator
  and ingestion.
- `router.ts`: all 8 endpoints from the integration spec plus an SSE realtime stream, as a manual
  dispatcher wired into `src/server.ts` — the installed TanStack Start version (1.168.32) has no
  file-based "server routes" API, so this isn't done via `src/routes/api/**` files.
- `auth.ts`: real JWT session verification (`jsonwebtoken`, HS256) and HMAC-SHA256 signed-request
  verification (with a timestamp window and nonce replay protection) for the ingestion endpoint.
- `paging.ts`: clinical on-call paging for P0 routes — a generic webhook transport (PagerDuty
  Events API v2 shape) with a console fallback when unconfigured.
- `repositories/`: a `Repository` interface with two implementations — `memory.ts` (the original
  in-memory scaffold) and `postgres.ts` (real SQL against the schema below) — selected by
  whether `DATABASE_URL` is set (`repositories/index.ts`).
- Shadow mode: setting `INGESTION_MODE=shadow` runs the full pipeline on ingest requests without
  persisting or paging, for validating routing decisions against real traffic before enabling
  writes.

**Database schema** (`db/migrations/`) — the canonical schema, runnable via
`scripts/setup-postgres.sh` (creates the role/db and applies `0001_init.sql` and
`0002_synthetic_metrics.sql`) and seedable with the synthetic dataset via
`scripts/seed-postgres.mjs`.

**Synthetic dataset** — a seeded quota corpus (`src/backend/synthetic/buildCorpus.ts`) covering
NPS, survey invitations, clinical sessions, closed-loop clocks, redaction quarantine, and
patient-session telemetry. The in-memory store builds it on first use. Postgres loads the JSONL
written by `bun scripts/generate-synthetic-data.mjs`. See `data/synthetic/README.md`.

**Behavioural telemetry (Hotjar)** (`src/lib/hotjar.ts`, `src/components/analytics/`) — an
SSR-safe Hotjar wrapper initialised from the root layout, fixed-name product events (filters, tab
views, simulator runs, error boundary), and `data-hj-suppress` masking on every verbatim,
session-telemetry, and simulator-input surface. Dev-only tooling, excluded from production
builds: a floating QA harness (`?debug=hotjar`) and a synthetic-data insights dashboard at
`/dev/hotjar-insights`, both driven by `src/test/fixtures/hotjarSyntheticData.ts`. See
[`docs/HOTJAR_TELEMETRY.md`](docs/HOTJAR_TELEMETRY.md), and
[`docs/PRIVACY_HOTJAR_DPIA.md`](docs/PRIVACY_HOTJAR_DPIA.md) before enabling it for real users.

**Tests** (`bun run test`) — 46 backend vitest tests (`src/backend/**/__tests__/`) covering
redaction, the safety gate, ABSA, routing, JWT/HMAC auth, paging, shadow mode, and full
request/response integration through the dispatcher — run against both the in-memory repository
(always) and the real Postgres repository (when `DATABASE_URL` is set) — plus 13 frontend tests
(`src/test/hotjar.test.ts`) for the Hotjar wrapper, synthetic fixtures, and dashboard metrics. See
`docs/VALIDATION_REPORT.md` for the full run, including the real bugs the tests caught before
this ever reached a repo history.

**CI** (`.github/workflows/ci.yml`) — runs the test suite against both repositories with a real
Postgres service container (migrated and seeded from `data/synthetic/` before the Postgres run),
plus `tsc --noEmit` and `eslint` scoped to `src/backend` (the new Hotjar files are Prettier-clean
but not yet in CI's lint scope).

### Known gaps and caveats (read before treating this as production-ready)

- **Live survey triggers are out of scope.** They belong in the actual Ellyra Health app's
  codebase, which this repo doesn't have access to.
- **Cloudflare Workers + `pg`:** `vite.config.ts` targets Cloudflare via Nitro, but the Postgres
  repository uses `pg` (node-postgres), which needs raw TCP sockets — not available in the
  standard Workers runtime. Deploying this to Cloudflare as-is will not be able to reach
  Postgres; either run the backend on a Node-compatible target, or switch to a Workers-compatible
  driver (e.g. Neon's serverless driver, or Cloudflare Hyperdrive) before deploying there.
- **The name-redaction heuristic is not a clinical NER model.** It only catches a name following
  a self-introduction cue ("this is X", "my name is X"); a name mentioned any other way is not
  redacted. Replace with an approved medical NER service before production use — see the comment
  in `src/backend/ingestion/redaction.ts`.
- **Auth is real but self-issued.** `auth.ts` verifies JWTs cryptographically, but there's no
  real identity provider behind it yet — `scripts/mint-dev-token.mjs` is a dev-only stand-in.
- **Realtime is single-process.** The SSE event stream is an in-memory pub/sub — it works
  correctly but doesn't fan out across multiple server instances; that needs a shared broker
  (e.g. Redis pub/sub) before horizontal scaling.
- **Frontend is not yet wired to the backend** — `src/lib/nps-data.ts` mock data is still what
  the UI renders from.
- **Hotjar is not cleared for real patient data.** Hotjar does not sign a HIPAA BAA, masking
  via `data-hj-suppress` is opt-in per element, and `initHotjar()` is not yet gated on user
  consent (required for UK/EU users). Until the decisions in `docs/PRIVACY_HOTJAR_DPIA.md` are
  signed off, leave `VITE_HOTJAR_SITE_ID` unset in any deployment that shows real feedback.
  `resetHotjarUser()` also isn't wired to a logout yet — the frontend has no auth flow.
- **Production builds must not set `VITE_ENABLE_HOTJAR_DEBUG=true`** — doing so compiles the
  dev QA harness and `/dev/hotjar-insights` into the bundle (as lazy chunks).
- The pre-existing Lovable-generated frontend has ~390 Prettier formatting violations unrelated
  to this work (`bun run lint` unscoped will show them); CI's lint step is scoped to
  `src/backend` for that reason.

## Future roadmap (next concrete steps)

1. Pick a Postgres-reachable deployment target (or a Workers-compatible driver) before deploying
   to Cloudflare — see the caveat above.
2. Replace the dev JWT issuance with the real workforce identity provider.
3. Replace the heuristic name-redaction pass with the approved medical NER service, keeping the
   existing regression test corpus (`src/backend/ingestion/__tests__/redaction.test.ts`) as a
   baseline and expanding it (OCR spacing, Unicode, adversarial text).
4. Connect the prototype UI's TanStack Query hooks to the real endpoints, surface by surface,
   replacing `src/lib/nps-data.ts` imports.
5. Move realtime pub/sub to a shared broker before running more than one server instance.
6. Resolve the Hotjar privacy decisions (`docs/PRIVACY_HOTJAR_DPIA.md` §5), then add consent
   gating to `initHotjar()` and wire `resetHotjarUser()` into logout once auth exists.
7. Layer in Phase 4's deeper analysis (root-cause quadrant, driver analysis, outcome correlation,
   taxonomy re-clustering) once the above is live and generating real data.

---

## How to bring up the app

The frontend and backend API run as a single TanStack Start process (`bun run dev` / `npm run
dev` under the hood) — there's no separate server to start.

**Prerequisites:** [Node.js](https://nodejs.org) 20.19+ or 22+ (npm comes with it) — Vite 8
and Vitest 5 do not run on Node 18 or earlier. [Bun](https://bun.sh) is optional but used
automatically if present (`bun.lock` is checked in) — it installs faster. Installing with npm
(rather than bun) currently needs `npm install --legacy-peer-deps` because of a pre-existing
peer-dependency conflict.

**Quick start (recommended):**

| Platform | Start | Stop |
|---|---|---|
| macOS / Linux | [`./start.sh`](start.sh) | [`./stop.sh`](stop.sh) |
| Windows (PowerShell) | [`./start.ps1`](start.ps1) | [`./stop.ps1`](stop.ps1) |

```sh
git clone https://github.com/mayukhg/ellyra-pulse
cd ellyra-pulse
./start.sh          # installs dependencies on first run, then starts the app
```

Then open **http://127.0.0.1:5173**. On first run the script also generates `.env` with fresh
`AUTH_JWT_SECRET`/`INGEST_HMAC_SECRET` values (see `.env.example`) — the backend needs these to
verify requests. It writes a PID file (`.ellyra-pulse.pid`) and logs (`.ellyra-pulse.log`) so
`./stop.sh` can find and stop the right process, and detects if the app is already running so it
won't start a second copy.

**Flags:**

| Flag | Effect |
|---|---|
| `--host`, `--port` | Override the bind address (default `127.0.0.1:5173`) |
| `--with-postgres` | Use a real Postgres database instead of the in-memory store — run `scripts/setup-postgres.sh` first |
| `--shadow` | Sets `INGESTION_MODE=shadow`: ingest requests are evaluated (redaction, safety gate, ABSA, routing) but nothing is persisted or paged |

**Using real Postgres instead of the in-memory store:**

```sh
bash scripts/setup-postgres.sh          # creates the role/db and applies db/migrations/*.sql
bun scripts/generate-synthetic-data.mjs # writes data/synthetic/generated/*.jsonl
bun scripts/seed-postgres.mjs           # optional: load that corpus into Postgres
DATABASE_URL=postgres://ellyra:ellyra_dev_pw@127.0.0.1:5432/ellyra_pulse ./start.sh --with-postgres
```

**Manual start**, if you'd rather not use the scripts:

```sh
npm i          # or: bun install
npm run dev    # or: bun run dev
```

**Verifying the backend is up**, once the app is running:

```sh
# Mint a workforce session token (dev-only — see scripts/mint-dev-token.mjs)
source .env
TOKEN=$(AUTH_JWT_SECRET=$AUTH_JWT_SECRET node scripts/mint-dev-token.mjs administrator)

curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:5173/api/v1/metrics/executive?from=2026-03-01&to=2026-09-21"
```

This should return live metrics computed from the synthetic quota corpus (built into the
in-memory store on first API request, or seeded into Postgres — see `data/synthetic/README.md`).

**Optional — Hotjar behavioural telemetry:** set these in `.env` or `.env.local` (see
`.env.example`). They're inlined at build time, so rebuild/restart after changing them.

| Variable | Effect |
|---|---|
| `VITE_HOTJAR_SITE_ID` | Hotjar site ID; Hotjar doesn't load at all when unset |
| `VITE_HOTJAR_VERSION` | Snippet version (default `6`) |
| `VITE_ENABLE_HOTJAR_DEBUG` | `true` = Hotjar debug logging + dev tooling compiled in. **Leave unset/`false` for production** |

In dev, the Hotjar QA harness sits collapsed in the bottom-right corner and the insights
dashboard is at **http://127.0.0.1:5173/dev/hotjar-insights**. Full guide:
[`docs/HOTJAR_TELEMETRY.md`](docs/HOTJAR_TELEMETRY.md).

**Using the dashboard UI once it's running:** see [`docs/HOW_TO_USE.md`](docs/HOW_TO_USE.md) for
a walkthrough of all four dashboard workflows (executive scorecard, root-cause drill-down,
verbatim review/closed-loop actions, and the sandbox simulator), plus the developer-only UX
telemetry tools, each with a diagram and click-by-click steps.
