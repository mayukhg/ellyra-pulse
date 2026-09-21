# Ellyra Pulse

Customer NPS Tracker & Sentiment Intelligence Platform for [Ellyra Health](https://ellyra.health/).

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
| **Phase 2 — Real backend** | Postgres wired to the migrations in `db/migrations/`, real authentication, production redaction (NER pass), realtime event delivery at scale, CI running the redaction/safety/contract tests | ⏳ Not started |
| **Phase 3 — Production routing** | Live survey triggers in the Ellyra app, signed ingestion endpoint in production, clinical on-call paging, shadow-mode validation against real traffic before enabling writes | ⏳ Not started |
| **Phase 4 — Deep-dive analysis** | Root-cause quadrant analysis, driver analysis (SHAP), outcome correlation (retention, repeat usage), monthly ABSA taxonomy re-clustering | ⏳ Not started |

## Current implementation

**Prototype UI** (`src/routes/`, `src/components/nps/`) — a Lovable-built React/TanStack Start
app with mock data (`src/lib/nps-data.ts`) rendering the executive scorecard, feature-level NPS
table, root-cause quadrant, ABSA explorer, verbatim/closed-loop hub, and a workflow simulator.
Not yet wired to the backend below.

**Backend scaffold** (`src/server/`, `src/routes/api/v1/`):
- `contracts.ts`: shared TypeScript types and zod validation schemas for every request/response.
- `ingestion/`: redaction (deterministic pattern matching + leakage scan), the clinical safety
  gate, an ABSA classifier, and the routing engine — each a standalone, testable module.
- `pipeline.ts`: orchestrates those stages in the required order for both the sandbox simulator
  and production ingestion.
- All 8 endpoints from the integration spec (executive/feature metrics, quadrant, ABSA,
  verbatims, workflow simulate, response ingest, ticket update) plus an SSE realtime stream, as
  TanStack Start server routes.
- `store.ts`: an **in-memory store standing in for Postgres** — the route handlers and
  aggregation queries are written against the same shape the real schema provides, but nothing
  persists across a process restart yet.

**Database schema** (`db/migrations/0001_init.sql`) — the full canonical schema (enums, four
fact/dim tables, append-only ticket history, append-only processing audit trail, indexes,
constraints) is written and ready to run against a real Postgres instance; nothing is currently
provisioned to run it against.

**Synthetic dataset** (`data/synthetic/`) — 8,000 generated NPS responses, ~900 derived tickets,
and matching audit events, shaped exactly like the canonical schema, for local development and
demos. See `data/synthetic/README.md`.

**Not yet built:** real authentication (currently a header-trusting stub in
`src/server/auth.ts`), a real medical NER pass for name/address redaction (currently deterministic
patterns only), the frontend's connection to the new backend endpoints (still reading mock data),
and everything in Phases 2–4 above.

## Future roadmap (next concrete steps)

1. Provision Postgres, run `db/migrations/0001_init.sql`, and replace `src/server/store.ts` with
   real repository modules — the route handlers' call shape shouldn't need to change.
2. Replace the auth stub with the real workforce identity provider and enforce tenant scoping on
   every query.
3. Add the approved medical NER pass for name/address redaction alongside the existing
   deterministic patterns, with a redaction regression test corpus (DOB formats, NHS checksum
   cases, MRN variants, OCR spacing, adversarial text).
4. Connect the prototype UI's TanStack Query hooks to the real endpoints, surface by surface,
   replacing `src/lib/nps-data.ts` imports.
5. Stand up the production ingestion path with signed-request verification and shadow-mode
   comparison against the prototype's calculations before enabling writes.
6. Layer in Phase 4's deeper analysis once the above is live and generating real data.

---

## Build with Lovable

This project was built with [Lovable](https://lovable.dev). Continue developing the prototype UI
in the [Lovable editor](https://lovable.dev/projects/16327ac0-e281-42d9-8416-3ae3b09541c7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into
  Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone https://github.com/mayukhg/ellyra-pulse
cd ellyra-pulse
npm i
npm run dev
```
