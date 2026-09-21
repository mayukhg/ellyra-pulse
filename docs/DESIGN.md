# Ellyra Health — NPS Feedback Automation & Sentiment Intelligence

**Product context:** Ellyra Health (ellyra.health) is a B2C medical AI product. This design
assumes a typical B2C health-AI surface area — a mobile/web app where users interact with an
AI health assistant (symptom triage, chat-based guidance, possibly telehealth hand-off) and
have accounts/subscriptions. Adjust the "touchpoints" list in §2 once the real product surfaces
are confirmed; everything downstream (workflows, schema, dashboard) plugs into whatever that
list turns out to be.

**Non-negotiable constraint:** this is health data. NPS verbatims from a medical AI product
routinely contain PHI ("it correctly caught my mom's afib symptoms," "the AI missed my son's
allergic reaction"). Every design decision below treats feedback text as PHI until proven
otherwise, not as generic SaaS review text.

---

## 1. Goals

1. Capture NPS (and lightweight CSAT/CES) at the right moments without survey fatigue.
2. Turn raw verbatims into structured, queryable signal automatically — no manual tagging queue.
3. Close the loop on detractors fast (this is a trust-and-safety issue for a medical product,
   not just a churn issue).
4. Give product/clinical/exec stakeholders a live view of sentiment, segmented by cohort and
   correlated with product usage — not just a lagging quarterly score.

---

## 2. Touchpoints (survey triggers)

Every trigger below fires only after the event has passed the **clinical risk filter** in §3 —
a red-flag session is excluded regardless of which row it would otherwise match.

| Trigger | Survey type | Example question | Why |
|---|---|---|---|
| Report summarized & viewed (2h delay, no red-flag) | NPS, 1-question | *"How confident do you feel discussing this report with your doctor?"* | Feature-specific "aha" moment, ties sentiment to the report-parsing feature itself |
| Symptom chat session completed | CSAT/NPS, 1-question | *"Did Ellyra help clarify your symptoms?"* | Feature-specific, immediate |
| After a completed telehealth visit (if applicable) | CSAT + CES | — | Transactional, ties to a specific episode |
| Quarterly relationship pulse (active users) | Full NPS | — | Longitudinal trend, the "official" score |
| Post-cancellation / downgrade | NPS + reason picklist | — | Churn root cause |
| App store review (iOS/Android) ingested via API | Sentiment only (no direct ask) | — | Public signal, no survey fatigue cost |
| Support ticket close | CSAT (1-question) | — | Cheap, high response rate, service-quality signal |

Rules of thumb: never ask NPS more than once per user per 90 days; suppress the pulse survey
for anyone who saw a transactional survey in the last 14 days; always let users skip. Prefer
feature-specific question copy (rows 1–2) over a generic "how likely are you to recommend"
wherever the triggering event maps to one feature — it reads as relevant rather than as a
generic survey, and it's what makes the feature-level NPS breakdown in §6.2 possible.

---

## 3. High-Level Architecture

```
┌─────────────┐   ┌───────────────────┐   ┌──────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ In-App      │──▶│  Clinical Risk    │──▶│  Ingestion   │──▶│    Enrichment      │──▶│   Data Warehouse  │
│ Event       │   │  Filter (gate)    │   │  Webhook /   │   │    Pipeline        │   │   (fact_nps +     │
│ (report     │   │  red-flag? ──────┐│   │  Event Bus   │   │  (PHI redact →     │   │   dim tables)     │
│ viewed,     │   │  session skips    ││   │  (queue, e.g.│   │   sentiment →      │   └────────┬──────────┘
│ chat closed)│   │  the survey below ││   │  SQS/Pub-Sub)│   │   ABSA tagging →   │            │
└─────────────┘   └────────┬──────────┘│   └──────────────┘   │   NPS category)     │            ▼
                            │           │                      └─────────┬──────────┘   ┌──────────────────┐
                  (low/med) ▼           ▼                                │              │   BI Dashboard   │
                   ┌─────────────┐   ┌──────────────────┐                ▼              │  (Looker/Metabase│
                   │ Contextual  │   │ Clinical Telemetry│      ┌─────────────────┐     │  /Superset)       │
                   │ NPS Trigger │   │ + in-product      │      │  Routing Engine  │     └──────────────────┘
                   │ (feature-   │   │ emergency-helpline│      │  (detractor →    │
                   │ specific ask)│  │ banner            │      │  CS ticket;       │
                   └─────────────┘   └──────────────────┘      │  promoter → ask   │
                                                                │  for review;      │
Other sources feed the same Ingestion step directly            │  passive → micro- │
(app store reviews, post-ticket CSAT, post-cancellation):      │  poll; churn-risk │
App Store/Play Console API, Zendesk/Intercom webhook  ────────▶│  flag)            │
                                                                └─────────────────┘
```

**Clinical risk filter (new, sits in front of every trigger):** before any survey fires, the
event is scored against the same acute-risk signal used for in-session safety monitoring (e.g.
red-flag keywords, a triage-confidence threshold below which the session was already escalated).
A red-flag session **never** receives a standard NPS/CSAT prompt — it routes straight to
clinical telemetry and, per §8, can surface an in-product emergency-helpline banner. Only
low/medium-risk sessions proceed to the contextual trigger.

Orchestration: a workflow engine (n8n self-hosted, or Temporal/Step Functions if you want
code-first durability) sits between ingestion and enrichment/routing so each stage is retryable,
observable, and independently deployable — don't chain this as one monolithic Lambda.

---

## 4. Automated Workflows

### 4.1 Ingestion
- Single **event contract** regardless of source: `{ user_id, response_id, source, nps_score
  (nullable), csat_score (nullable), free_text (nullable), context: {feature, session_id,
  episode_id}, submitted_at }`.
- Adapters normalize each source (Delighted/Qualtrics/in-house widget for in-app; App Store
  Connect / Google Play Console APIs for store reviews; Zendesk/Intercom webhook for post-ticket
  CSAT) into that contract and drop it on the queue.
- Idempotency key = `response_id` to survive webhook retries.

### 4.2 PHI Redaction (before anything else touches the text)
- Run free text through a PHI-scrubbing pass (named-entity redaction for names, DOB, MRN-like
  numbers, phone/email) **before** it is persisted in any analytics store or sent to a
  third-party LLM API.
- Keep the raw, unredacted text only in the compliance-tier PHI store (encrypted, access-logged,
  short retention), referenced by ID. The analytics warehouse only ever sees the redacted
  version.

### 4.3 Enrichment (automated tagging)
For each redacted response, run:
1. **NPS categorization**: 0–6 detractor, 7–8 passive, 9–10 promoter.
2. **Sentiment scoring**: continuous score (-1 to 1) on the free text, independent of the NPS
   number (they disagree more often than you'd expect — a 9 with an angry comment is a real
   signal).
3. **Aspect-based sentiment tagging (ABSA)**: LLM classification against the taxonomy in §5.2
   — `clinical_trust`, `tone_and_bedside_manner`, `document_parsing_ocr`, `actionability`, plus
   operational tags (`cost/billing`, `ui_confusion`, `response_speed`). Multi-label with a
   per-aspect sentiment polarity (not just presence/absence) — one comment often hits 2–3
   aspects with different polarity on each (e.g. positive on tone, negative on OCR).
4. **Urgency/safety flag**: a dedicated classifier (not the general theme tagger) that flags
   text suggesting a missed/incorrect medical detection, a safety concern, or self-harm
   language. This routes to a *different, faster* queue than normal detractor follow-up —
   treat it like a clinical safety report, not a CS ticket.

### 4.4 Routing & closed-loop actions
| Condition | Action |
|---|---|
| Detractor (0–6) | Auto-create CS follow-up ticket with SLA (e.g. 24h for medical product), pre-filled with theme tags and sentiment |
| Safety-flagged text (any score) | Immediate page to clinical/safety on-call, separate from CS queue |
| Promoter (9–10) + positive theme | Trigger review-request flow (App Store/Trustpilot) or referral prompt |
| Passive (7–8) | In-session micro-poll, single choice: *"What was missing? (More detail / Simpler terms / Faster speed / Doctor connection)"* — cheap signal, no ticket created |
| Detractor mentions `billing`/`cost` | Route to billing support, not general CS |
| Repeat detractor (2nd low score in 90 days) | Flag account as churn-risk, notify CS lead, suppress further automated surveys |

Every routed action writes back a status (`open/contacted/resolved`) so **close-the-loop rate**
and **time-to-first-contact** become dashboard metrics, not just anecdote.

### 4.5 Orchestration choice
- **n8n** (self-hosted) is the pragmatic default: visual workflow for the routing rules above,
  easy to hand to ops/CS to adjust thresholds without a deploy, native webhook + queue nodes.
- If the team is already AWS-native and wants stronger durability/retry guarantees for the
  safety-flag path specifically, put *that one* critical path on Step Functions/Temporal and
  leave the rest on n8n. Don't over-engineer the whole pipeline for the sake of one urgent path.

---

## 5. Deep-Dive Analysis

### 5.1 Driver analysis
Model NPS (or promoter/detractor as binary) against usage and product features: session
frequency, time-to-first-response from the AI, whether the user ever escalated to a human,
subscription tier, tenure, platform (iOS/Android/web). Use a simple regression or gradient-boosted
tree + SHAP values to answer "what actually moves the score" rather than relying on which theme
tag appears most often (frequency ≠ impact).

### 5.2 Verbatim theme clustering (ABSA taxonomy)
Standard NPS treats all detractors equally; in a medical AI context, dissatisfaction stems from
distinct drivers that deserve separate tracking rather than one flat "theme" tag:

- **Clinical trust** — perceived accuracy, hallucination suspicion, source citations.
  *"The scan breakdown matched what my GP said"* (+) vs. *"Told me my normal blood test was
  alarming"* (–).
- **Tone & bedside manner** — compassionate vs. robotic/dismissive phrasing.
  *"Calmed my anxiety"* (+) vs. *"Felt cold and overly alarming"* (–).
- **Document parsing / OCR quality** — *"Read my blurry PDF seamlessly"* (+) vs. *"Failed to
  parse page 2 of my MRI"* (–).
- **Actionability** — *"Gave me 5 bullet points to ask my consultant"* (+) vs. *"Just told me to
  consult a doctor without explaining anything"* (–).
- Operational aspects (`cost/billing`, `ui_confusion`, `response_speed`) stay as a secondary,
  lower-priority tier — they're real but not trust-affecting the way the four above are.

Maintain this as a living taxonomy: embed free text, cluster (HDBSCAN or k-means over
embeddings) to surface candidate new aspects, have an LLM propose a label per cluster, human
review before promoting it. Re-run monthly to catch emerging themes (e.g. a new complaint
cluster after a feature launch). Keep an "aspect × NPS category" cross-tab as the core deep-dive
artifact — it answers "what are detractors actually saying" vs. "what do promoters love," per
aspect, side by side.

### 5.3 Root-cause quadrant analysis
Plot **volume of feedback** (x-axis) against **impact on net sentiment** — i.e. how much an
aspect's presence drags NPS down when it appears (y-axis) — per aspect, per time window. This
separates cosmetic, high-volume complaints from rare-but-trust-destroying failures:

- **High volume, low impact** — polish items (minor UI confusion). Fix opportunistically.
- **High volume, high impact** — systemic issues (e.g. widespread tone complaints). Prioritize.
- **Low volume, high impact — the critical quadrant** — rare but severe failures (misreading a
  decimal point or unit in a blood panel, missing a page during OCR on a scanned PDF). Low
  frequency means these are easy to miss in a simple theme-frequency table, but they are the
  ones most likely to break clinical trust for the specific user who hit them. Route anything
  landing here to the same review process as a safety flag, even if it didn't trip the
  safety-flag classifier itself.
- **Low volume, low impact** — noise; track but don't act.

Refresh this quadrant on the same monthly cadence as the taxonomy re-clustering in §5.2.

### 5.4 Segmentation
Cut every metric by: new (<30d) vs. established users, condition/use-case category if captured,
platform, subscription tier, and — importantly for a medical AI product — whether the session
involved AI-only guidance vs. human clinician hand-off. Sentiment about "the AI" and sentiment
about "the human follow-up" are different products from the user's point of view; don't average
them together.

### 5.5 Correlation with outcomes
Where available, join NPS/sentiment to downstream outcomes: retention/renewal, repeat usage,
support ticket volume per user, and (if the product tracks it) self-reported symptom resolution.
This is what turns "our score is 42" into "detractors in the triage-accuracy theme churn at 3x
the rate of other detractors — fix that first."

### 5.6 Root-cause deep dives (ad hoc)
A saved-query/notebook workflow (not a permanent dashboard tile) for when a metric moves: pull
all verbatims for a theme+segment+time-window, read a sample, check if it correlates with a
specific release or AI model version. Version/release metadata should be attached to every
response's context object precisely so this join is possible.

---

## 6. Metrics Dashboard

### 6.1 Top-line (exec view)
- NPS (rolling 30/90-day), trend line with release markers annotated.
- **Relational vs. transactional NPS** — the quarterly pulse score (relational, brand-level)
  shown alongside per-feature NPS from the contextual triggers in §2 (transactional). Target
  relational NPS > 50; transactional NPS tracked per feature so a strong brand score can't mask
  a broken feature.
- Response rate (are we even getting signal).
- Promoter / Passive / Detractor distribution (stacked bar over time, not just the single number).
- Sentiment score (free-text-derived), shown alongside NPS — flags when they diverge.
- **Anxiety Reduction Delta (ARD)** — self-reported anxiety before vs. after report
  interpretation (2-point pulse check). Target >75% positive shift; this is the metric closest
  to Ellyra's actual value proposition, not a proxy for it.
- **Clinical Comprehension Score (CCS)** — *"Did you understand the explanation without needing
  a third-party search?"* Target >85% positive.
- **Hallucination / Inaccuracy Flag Rate** — % of sessions where a user reports generated
  content conflicting with known medical fact or their doctor's advice. Target <0.2%; treat any
  sustained rise as a P0, not a product-quality nit.
- **Disclaimer Fatigue Index** — % of negative-sentiment mentions specifically about defensive
  legal disclaimers impeding readability. Target <5%; a guardrail-vs-usability tension metric.

### 6.2 Operational view
- Close-the-loop rate (% of detractors contacted within SLA).
- Median time-to-first-contact for detractors (target <5 min for the detractor path per §4.4).
- Open safety-flag count (should basically always be near-zero and visibly alarmed if not).
- Aspect frequency trend (§5.2) — which ABSA aspects are growing/shrinking week over week.
- **Feature-level NPS breakdown** — NPS score, response volume, and top driver aspect per
  feature (e.g. Lab/Blood Report Parser, MRI/Imaging Insights, Symptom Chat, GP Question
  Builder), so a strong overall score can't hide one weak feature.

### 6.3 Segment explorer
- NPS/sentiment sliced by cohort dimensions from §5.4, with drill-down to the verbatim list for
  any slice.

### 6.4 Verbatim explorer
- Searchable/filterable table of redacted verbatims with their tags — this is what
  product/clinical teams actually read day to day, and it should link back to the routed
  ticket status.

### 6.5 Alerting
- Real-time page for any safety-flagged response.
- Daily digest if detractor rate on a given theme jumps >X% week-over-week.
- Weekly summary email to product/CS leads with top themes and close-the-loop rate.

### 6.6 Wireframe (exec + operational view combined)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ELLYRA HEALTH — SENTIMENT & NPS INTELLIGENCE PLATFORM               [Time: Last 30 Days]│
├──────────────────────┬──────────────────────┬──────────────────────┬───────────────────┤
│ Overall NPS: +54     │ CSAT: 4.6 / 5.0      │ Anxiety Delta: -42%  │ Safety Flags: 0.08%│
│ [ ▲ +4 pts MoM ]     │ [ ▲ 0.2 MoM ]        │ (Pre vs. Post)       │ [ ▼ 0.02% MoM ]   │
├──────────────────────┴──────────────────────┴──────────────────────┴───────────────────┤
│ FEATURE-LEVEL NPS BREAKDOWN                                                            │
│ ┌───────────────────────────┬──────────────┬───────────────┬─────────────────────────┐ │
│ │ Feature                   │ NPS Score    │ Response Vol  │ Top Driver Aspect       │ │
│ ├───────────────────────────┼──────────────┼───────────────┼─────────────────────────┤ │
│ │ Lab / Blood Report Parser │ +62          │ 1,420         │ Clarity of markers      │ │
│ │ MRI / Imaging Insights    │ +48          │ 680           │ Needs deeper detail     │ │
│ │ Symptom Chat Companion    │ +51          │ 2,100         │ Empathetic tone         │ │
│ │ GP Question Builder       │ +71          │ 890           │ High actionability      │ │
│ └───────────────────────────┴──────────────┴───────────────┴─────────────────────────┘ │
├──────────────────────────────────────────┬─────────────────────────────────────────────┤
│ ABSA ASPECT BREAKDOWN                    │ REAL-TIME DETRACTOR / SAFETY ALERT FEED     │
│ [Positive]                                │                                             │
│ • Clear doctor discussion points (38%)   │ ⚠️ [Alert #1042] Blood Test Parser          │
│ • De-jargoned complex terminology (29%)  │ "Missed the reference range on page 3."     │
│ • Reassuring, calm phrasing (18%)        │ Status: Ticket Created → Routed to QA       │
│                                           │                                             │
│ [Negative]                                │ ⚠️ [Alert #1039] Symptom Chat               │
│ • OCR failed on scanned PDF (12%)        │ "Too many generic disclaimers."             │
│ • Wanted direct diagnosis (8%)           │ Status: Auto-Followup Sent                  │
└──────────────────────────────────────────┴─────────────────────────────────────────────┘
```

This is the concrete target layout for §6.1/§6.2 — the feature-level table draws on the
`feature` column added to `fact_nps_response` in §7, and the alert feed is fed directly by the
routing engine's `routed_status` writes.

### 6.7 Suggested tooling
Metabase or Superset (open-source, fast to stand up, good enough for this) reading from the
warehouse `fact_nps_response` table below; Looker if the org already has it. Avoid building a
bespoke dashboard frontend unless the org has specific product-embedding needs.

---

## 7. Data Model Sketch

```
fact_nps_response
  response_id            pk
  user_id                fk -> dim_user
  source                 enum(in_app, email, app_store, ticket, telehealth)
  nps_score              int nullable (0-10)
  csat_score             int nullable (1-5)
  sentiment_score        float (-1..1)
  nps_category           enum(promoter, passive, detractor)
  feature                text     -- e.g. lab_report_parser, mri_insights, symptom_chat, gp_question_builder
  aspects                array<text>            -- ABSA multi-label, see §5.2
  aspect_sentiment       jsonb    -- per-aspect polarity, e.g. {"clinical_trust": -1, "tone": 1}
  safety_flag            boolean
  redacted_text          text
  phi_ref_id             uuid  -- pointer into compliance-tier PHI store, not joined by default
  release_version        text
  submitted_at           timestamp
  routed_status          enum(none, ticket_open, ticket_resolved, review_requested)
  time_to_first_contact  interval nullable

dim_user
  user_id                pk
  signup_at              timestamp
  platform               enum(ios, android, web)
  subscription_tier      text
  tenure_days            int (derived)

dim_theme
  theme_id               pk
  label                  text
  added_at               timestamp   -- taxonomy evolves; track when
```

---

## 8. Privacy & Compliance (read this before building anything else)

- Treat all free-text NPS/CSAT responses as PHI until redacted. Redaction happens in the
  ingestion pipeline, before analytics storage, before any third-party LLM call.
- If using a third-party LLM API for sentiment/theme tagging, confirm a BAA is in place, or run
  redaction aggressively enough beforehand that no PHI reaches that API regardless.
- Access to the unredacted PHI store is separately permissioned and audit-logged; the BI
  dashboard and analytics warehouse never touch it.
- Retention: define a deletion policy for raw verbatims consistent with your data retention
  policy / applicable regulations (HIPAA, and state-level health-data laws e.g. CMIA if
  California users); redacted/aggregated theme data can be retained longer than raw text.
- Safety-flag detection is a compliance control, not a nice-to-have — document its false-negative
  rate and review process, since missing a real safety complaint is the highest-severity failure
  mode of this whole system.
- **Clinical triage guardrail**: if the clinical risk filter (§3) or any free-text field detects
  acute-risk language (self-harm, chest pain, stroke symptoms, or similar), the system must (a)
  suppress all standard NPS/marketing outreach for that session, and (b) trigger an in-product
  safety banner surfacing regional emergency helplines immediately — this is a UI-level control,
  not just an internal alert to clinical/safety on-call. Treat this as a P0, ship it in Phase 1
  (§9), not deferred alongside the rest of the analytics buildout.

---

## 9. Phased Roadmap

**Phase 1 (MVP, 2–4 weeks):** clinical risk filter gating every trigger + in-product emergency
safety banner (§3, §8 — safety-critical, ships first regardless of the rest of the buildout);
in-app + post-ticket surveys → ingestion → PHI redaction → manual-ish ABSA tagging (LLM-assisted,
human-reviewed taxonomy) → basic Metabase dashboard (NPS trend, promoter/passive/detractor
split, response rate). No routing automation yet — CS manually reviews a detractor list.

**Phase 2 (4–8 weeks):** automated routing (detractor tickets, safety-flag paging, promoter
review-ask, passive micro-poll), close-the-loop tracking, segment explorer, verbatim explorer,
feature-level NPS breakdown and the full dashboard wireframe in §6.6.

**Phase 3 (ongoing):** driver analysis, outcome correlation, monthly ABSA taxonomy re-clustering
and root-cause quadrant refresh (§5.3), the extended KPI set (ARD, CCS, hallucination flag rate,
disclaimer fatigue index), release-version annotation, weekly digest automation.

---

## 10. Suggested Repo Layout for `customer-nps-tracker`

```
customer-nps-tracker/
├── docs/
│   └── DESIGN.md              # this document
├── ingestion/                 # source adapters (in-app, app-store, ticketing)
├── enrichment/                # PHI redaction, sentiment, theme tagging, safety-flag classifier
├── routing/                   # n8n workflow exports / routing rule definitions
├── warehouse/                 # schema migrations for fact/dim tables (§7)
├── dashboard/                 # Metabase/Superset config or embed code, if version-controlled
└── README.md
```
