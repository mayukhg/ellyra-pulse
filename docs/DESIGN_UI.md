# Ellyra Health NPS Tracker: UI Integration and Backend Requirements

**Audience:** Claude Code implementing the production backend and replacing the prototype's mock data.

**System context:** Ellyra Health is a B2C medical-AI product covering symptom guidance, imaging analysis, lab/blood report summarisation, and preparation for GP visits. Feedback can contain protected health information (PHI). Clinical safety and redaction are hard requirements, not optional enhancements.

## 1. Goal and non-negotiable boundaries

Build a versioned backend that powers the existing dashboard while preserving its current information architecture and interactions. The backend must:

- calculate NPS and medical-AI trust metrics from canonical response records;
- expose aggregate analysis without leaking raw PHI;
- redact sensitive text before any LLM, embedding, analytics, logging, or observability boundary;
- route possible clinical harm independently of NPS tier or sentiment;
- support filterable, cursor-paginated verbatims and ticket updates;
- push material response, safety, and ticket changes to connected dashboards;
- preserve an immutable audit trail for ingestion, redaction, classification, and routing;
- return only the minimum fields required by each UI surface.

The UI must never receive original unredacted feedback. The public/API-facing `text` field always means redacted text.

## 2. UI architecture and component hierarchy

```text
NpsIntelligencePage
├── DashboardHeader
│   ├── ReportingWindow
│   ├── PhiEnforcementStatus
│   └── OpenP0Count
├── GlobalFilterState
│   ├── DateRange
│   ├── FeatureFilter
│   ├── CohortFilter
│   ├── AspectFilter
│   └── SelectedQuadrantTheme
├── ExecutiveScorecard
│   ├── OverallNpsCard
│   │   ├── OverallNps
│   │   ├── MonthOverMonthDelta
│   │   ├── RelationalNps
│   │   ├── TransactionalNps
│   │   ├── ResponseRate
│   │   └── TierDistribution
│   ├── NpsTrendChart
│   ├── MedicalTrustKpiGrid
│   │   ├── AnxietyReductionDelta
│   │   ├── ClinicalComprehensionScore
│   │   ├── HallucinationFlagRate
│   │   └── DisclaimerFatigueIndex
│   └── FeatureNpsTable
├── RootCauseWorkspace
│   ├── QuadrantScatterPlot
│   └── AbsaMatrix
├── VerbatimClosedLoopHub
│   ├── ClosedLoopSlaSummary
│   ├── VerbatimFilters
│   ├── RedactedVerbatimList
│   └── VerbatimDetailDialog
│       ├── SessionTelemetry
│       └── TicketActions
└── WorkflowSimulator
    ├── TestInput
    ├── ClinicalRiskGate
    ├── PhiScrubber
    ├── AbsaAndSafetyClassifier
    └── RoutingDecision
```

### UI query boundaries

Use one query per independently refreshable surface:

| UI surface | Query key | Endpoint |
|---|---|---|
| Executive metrics | `['executive', filters]` | `GET /api/v1/metrics/executive` |
| Feature table | `['features', filters]` | `GET /api/v1/metrics/features` |
| Quadrant | `['quadrant', filters]` | `GET /api/v1/analysis/quadrant` |
| ABSA matrix | `['absa', filters]` | `GET /api/v1/analysis/absa` |
| Verbatim list | `['verbatims', filters, cursor]` | `GET /api/v1/verbatims` |
| Workflow simulation | mutation | `POST /api/v1/workflow/simulate` |
| Production ingestion | server-to-server mutation | `POST /api/v1/responses/ingest` |
| Ticket status | mutation | `PATCH /api/v1/tickets/:id` |

Feature-row and quadrant-dot selections update shared filters. Selecting a quadrant point should switch to the Verbatim Hub and apply its feature, aspect, and theme filters. Aggregate queries should be invalidated when an ingestion or ticket event affects the current reporting window.

## 3. Canonical data model

Use UUID primary keys, `timestamptz` in UTC, explicit foreign keys, database constraints, and append-only audit records. Do not place PHI in dimensions, logs, analytics tables, search indexes, event payloads, or model prompts.

### 3.1 `fact_nps_response`

One record per accepted survey response.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `response_id` | uuid | yes | Primary key; generated server-side |
| `external_response_id` | text | no | Idempotency key unique within `source_system` |
| `received_at` | timestamptz | yes | Original receipt time |
| `survey_type` | enum | yes | `relational` or `transactional` |
| `nps_score` | smallint | yes | Constraint `0 <= nps_score <= 10` |
| `nps_tier` | enum | yes | Derived: `detractor`, `passive`, `promoter` |
| `feature_touchpoint_id` | uuid | no | FK to `dim_feature_touchpoint` |
| `user_cohort_id` | uuid | no | FK to `dim_user_cohort`; no direct user ID in analytics responses |
| `session_ref` | text | no | Pseudonymous, access-controlled session reference |
| `channel` | text | yes | In-app, email, web, etc. |
| `locale` | text | no | BCP 47 language tag |
| `response_eligible` | boolean | yes | Included in denominator for response rate |
| `verbatim_redacted` | text | no | Only redacted text; safe for authorised UI retrieval |
| `verbatim_ciphertext_ref` | text | no | Pointer to separately encrypted restricted vault, never returned by these APIs |
| `redaction_tags` | text[] | yes | e.g. `DOB`, `NAME`, `MRN`, `NHS_NUMBER` |
| `redaction_count` | integer | yes | Number of replacements |
| `redaction_version` | text | yes | Scrubber rules/model version |
| `sentiment_score` | numeric(4,3) | no | Range −1.000 to +1.000 |
| `aspects` | jsonb | yes | Validated array of aspect/polarity/confidence objects |
| `safety_flag` | boolean | yes | Safety gate output |
| `safety_reason_codes` | text[] | yes | Controlled vocabulary; no free-text PHI |
| `safety_confidence` | numeric(4,3) | no | Range 0–1 |
| `route_action` | enum | yes | `p0_clinical_page`, `cs_ticket`, `review_prompt`, `micro_poll` |
| `model_version` | text | no | Product model serving the originating session |
| `classifier_version` | text | yes | Safety/ABSA bundle version |
| `processing_status` | enum | yes | `received`, `redacted`, `classified`, `routed`, `failed` |
| `created_at` | timestamptz | yes | Server timestamp |

Recommended indexes: `(received_at DESC)`, `(feature_touchpoint_id, received_at DESC)`, `(nps_tier, received_at DESC)`, partial `(received_at DESC) WHERE safety_flag`, and GIN indexes on `aspects` and `redaction_tags`. Use a privacy-reviewed search vector built from `verbatim_redacted` only.

### 3.2 `dim_user_cohort`

A privacy-preserving analytical segment, never a patient profile.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `user_cohort_id` | uuid | yes | Primary key |
| `cohort_key` | text | yes | Stable unique key |
| `cohort_name` | text | yes | Human-readable label |
| `plan_type` | text | no | Approved low-cardinality value |
| `tenure_band` | text | no | e.g. `<30d`, `30–180d`, `>180d` |
| `region_group` | text | no | Broad geography only; avoid small groups |
| `acquisition_channel` | text | no | Controlled value |
| `is_active` | boolean | yes | Soft retirement |
| `valid_from` | timestamptz | yes | Slowly-changing dimension validity |
| `valid_to` | timestamptz | no | Null for current record |

Enforce minimum cohort sizes in query logic. Suppress breakdowns below the approved privacy threshold, recommended `n < 20`.

### 3.3 `dim_feature_touchpoint`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `feature_touchpoint_id` | uuid | yes | Primary key |
| `feature_key` | text | yes | Stable API key |
| `feature_name` | text | yes | Current UI display name |
| `product_area` | text | yes | Lab, imaging, chat, GP preparation |
| `touchpoint_type` | text | yes | Report, conversation, builder, etc. |
| `is_clinical` | boolean | yes | Drives controls and reporting |
| `is_active` | boolean | yes | Soft retirement |
| `effective_from` | timestamptz | yes | Version validity |
| `effective_to` | timestamptz | no | Null for current record |

Seed keys for `lab_blood_parser`, `mri_imaging_insights`, `symptom_chat_companion`, and `gp_question_builder`.

### 3.4 `fact_closed_loop_ticket`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `ticket_id` | uuid | yes | Primary key |
| `response_id` | uuid | yes | FK to `fact_nps_response` |
| `ticket_type` | enum | yes | `p0_clinical` or `customer_success` |
| `status` | enum | yes | `open`, `contacted`, `resolved`, `escalated` |
| `priority` | enum | yes | `p0`, `p1`, `standard` |
| `owner_team` | text | yes | Controlled team code |
| `owner_id` | uuid | no | Authorised workforce identity |
| `created_at` | timestamptz | yes | SLA clock start |
| `first_contact_at` | timestamptz | no | Used for Time to First Contact |
| `resolved_at` | timestamptz | no | Used for close rate and resolution time |
| `sla_due_at` | timestamptz | yes | 15 minutes for P0, 24 hours for detractor CS |
| `sla_breached_at` | timestamptz | no | Set once when breached |
| `resolution_code` | text | no | Controlled taxonomy |
| `last_updated_by` | uuid | yes | Audit actor |
| `version` | integer | yes | Optimistic concurrency token |
| `updated_at` | timestamptz | yes | Last mutation time |

Add a separate append-only `ticket_status_event` table recording old/new state, timestamp, actor, request ID, and reason. Never overwrite history.

## 4. Shared TypeScript contracts

```ts
export type IsoDateTime = string;
export type NpsTier = 'promoter' | 'passive' | 'detractor';
export type SurveyType = 'relational' | 'transactional';
export type TicketStatus = 'open' | 'contacted' | 'resolved' | 'escalated';
export type RouteAction =
  | 'p0_clinical_page'
  | 'cs_ticket'
  | 'review_prompt'
  | 'micro_poll';

export interface AnalyticsFilters {
  from: string;                 // YYYY-MM-DD inclusive
  to: string;                   // YYYY-MM-DD exclusive
  feature?: string;
  cohort?: string;
  aspect?: string;
  surveyType?: SurveyType;
  timezone?: string;            // default UTC
}

export interface MetricValue {
  value: number;
  previousValue: number | null;
  delta: number | null;
  numerator?: number;
  denominator?: number;
  status?: 'healthy' | 'watch' | 'alarm';
  target?: { operator: 'gt' | 'gte' | 'lt' | 'lte'; value: number };
}

export interface NpsDistribution {
  promotersPct: number;
  passivesPct: number;
  detractorsPct: number;
  promotersCount: number;
  passivesCount: number;
  detractorsCount: number;
}

export interface ExecutiveMetricsResponse {
  generatedAt: IsoDateTime;
  period: { from: string; to: string; timezone: string };
  sample: { responses: number; eligibleSurveys: number; suppressed: boolean };
  nps: {
    overall: MetricValue;
    relational: MetricValue;
    transactional: MetricValue;
    responseRate: MetricValue;
    distribution: NpsDistribution;
    trend: Array<{ period: string; relational: number; transactional: number }>;
  };
  medicalTrust: {
    anxietyReductionDelta: MetricValue;
    clinicalComprehensionScore: MetricValue;
    hallucinationFlagRate: MetricValue;
    disclaimerFatigueIndex: MetricValue;
  };
  closedLoop: {
    medianTimeToFirstContactSeconds: number | null;
    closeRate: MetricValue;
    openP0Count: number;
  };
}

export interface FeatureMetric {
  featureKey: string;
  featureName: string;
  nps: number;
  monthOverMonthDelta: number | null;
  responseCount: number;
  distribution: NpsDistribution;
  topDriver: { aspect: string; label: string; impact: number } | null;
  safetyFlagCount: number;
}

export interface QuadrantPointDto {
  id: string;
  theme: string;
  featureKey: string;
  aspect: string;
  volume: number;
  netSentimentImpact: number;
  critical: boolean;
  note: string;
}

export interface AbsaRowDto {
  aspect: string;
  category: 'clinical' | 'operational';
  mentions: number;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
}

export interface VerbatimListItem {
  id: string;
  receivedAt: IsoDateTime;
  score: number;
  tier: NpsTier;
  sentiment: number;
  feature: { key: string; name: string };
  surveyType: SurveyType;
  text: string;                 // redacted only
  redactions: Array<{ tag: string; count: number }>;
  aspects: Array<{ aspect: string; polarity: number; confidence: number }>;
  safety: { flagged: boolean; reasonCodes: string[] };
  routeAction: RouteAction;
  ticket: null | {
    id: string;
    status: TicketStatus;
    slaDueAt: IsoDateTime;
    breached: boolean;
  };
  telemetry: {
    sessionRef: string | null;
    modelVersion: string | null;
    deviceFamily: string | null;
    channel: string;
  };
}

export interface CursorPage<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { requestId: string; generatedAt: IsoDateTime };
}
```

Percentages use numeric percentage points (`78.4`, not `0.784`). Sentiment uses `-1..1`. Durations use seconds. Dates use ISO 8601 UTC in responses. Return `null`, never fabricated zero, when a metric is unavailable or suppressed.

## 5. API requirements

All endpoints are under `/api/v1`, require an authenticated workforce session except the separately authenticated ingestion endpoint, and return `application/json`. Validate query/body data and reject unknown enum values. Include `requestId` in responses and server logs. Do not expose database error details.

### 5.1 `GET /api/v1/metrics/executive`

**Query:** all `AnalyticsFilters` fields.

**Response:** `ExecutiveMetricsResponse`.

Definitions:

- Overall NPS = `% Promoters − % Detractors`, range −100 to +100.
- Relational NPS includes relationship surveys; transactional NPS includes post-touchpoint surveys.
- Response rate = valid responses / eligible delivered surveys × 100.
- ARD = paired responses with lower post-explanation anxiety / valid paired anxiety responses × 100; target `>75%`.
- CCS = users reporting understanding without third-party search / valid comprehension responses × 100; target `>85%`.
- Hallucination flag rate = qualifying mismatch-flagged sessions / eligible clinical sessions × 100; alarm at `>=0.2%`.
- Disclaimer fatigue = responses with negative disclaimer sentiment / responses mentioning or exposed to disclaimers, per the approved analytics definition; target `<5%`.
- Time to First Contact = median `first_contact_at - created_at` for eligible tickets.
- Close rate = tickets resolved / tickets created in period × 100. Do not silently switch to “tickets resolved in period.”

Example:

```json
{
  "generatedAt": "2026-09-21T05:30:00Z",
  "period": { "from": "2026-08-22", "to": "2026-09-21", "timezone": "UTC" },
  "sample": { "responses": 12480, "eligibleSurveys": 52437, "suppressed": false },
  "nps": {
    "overall": { "value": 57, "previousValue": 53, "delta": 4 },
    "relational": { "value": 52, "previousValue": 50, "delta": 2 },
    "transactional": { "value": 61, "previousValue": 57, "delta": 4 },
    "responseRate": { "value": 23.8, "previousValue": 22.2, "delta": 1.6, "numerator": 12480, "denominator": 52437 },
    "distribution": { "promotersPct": 68, "passivesPct": 21, "detractorsPct": 11, "promotersCount": 8486, "passivesCount": 2621, "detractorsCount": 1373 },
    "trend": [{ "period": "2026-09", "relational": 52, "transactional": 61 }]
  },
  "medicalTrust": {
    "anxietyReductionDelta": { "value": 78.4, "previousValue": 76.3, "delta": 2.1, "status": "healthy", "target": { "operator": "gt", "value": 75 } },
    "clinicalComprehensionScore": { "value": 82.6, "previousValue": 83.4, "delta": -0.8, "status": "watch", "target": { "operator": "gt", "value": 85 } },
    "hallucinationFlagRate": { "value": 0.31, "previousValue": 0.22, "delta": 0.09, "status": "alarm", "target": { "operator": "lt", "value": 0.2 } },
    "disclaimerFatigueIndex": { "value": 6.8, "previousValue": 5.6, "delta": 1.2, "status": "watch", "target": { "operator": "lt", "value": 5 } }
  },
  "closedLoop": {
    "medianTimeToFirstContactSeconds": 11880,
    "closeRate": { "value": 74, "previousValue": 68, "delta": 6 },
    "openP0Count": 3
  }
}
```

### 5.2 `GET /api/v1/metrics/features`

**Query:** `from`, `to`, `cohort`, `surveyType`, `timezone`, optional repeated `feature`.

**Response:** `{ data: FeatureMetric[]; meta: { generatedAt; requestId } }`.

Sort by response count descending by default. `topDriver` must come from the same period and filters. Suppress or mark rows below the privacy minimum.

### 5.3 `GET /api/v1/analysis/quadrant`

**Query:** analytics filters plus `minVolume`, optional `criticalOnly`.

**Response:** `{ data: QuadrantPointDto[]; thresholds: { highVolume: 300; highAbsoluteImpact: 4 }; meta }`.

`netSentimentImpact` must be a documented, versioned model output. Return the analysis model version in `meta`. Safety-critical themes can never be removed solely by `minVolume`; return them with `critical: true`.

### 5.4 `GET /api/v1/analysis/absa`

**Query:** analytics filters.

**Response:** `{ data: AbsaRowDto[]; taxonomyVersion: string; meta }`.

Allowed initial taxonomy:

- Clinical Trust
- Tone & Bedside Manner
- Document Parsing / OCR Quality
- Actionability
- Billing / Cost
- UI Confusion
- Response Speed

Polarity percentages should total 100 within normal rounding tolerance. Store confidence but aggregate only tags above the approved threshold.

### 5.5 `GET /api/v1/verbatims`

**Query:**

```ts
interface VerbatimQuery extends AnalyticsFilters {
  polarity?: 'positive' | 'negative' | 'neutral';
  safetyRisk?: boolean;
  slaStatus?: TicketStatus;
  theme?: string;
  search?: string;              // redacted text only
  cursor?: string;              // opaque, signed or server-generated
  limit?: number;               // default 25, maximum 100
  sort?: 'received_desc' | 'sla_due_asc';
}
```

**Response:** `CursorPage<VerbatimListItem>`.

Use stable cursor ordering such as `(received_at DESC, response_id DESC)`. Search must operate only on redacted text. Users without clinical-safety permission must receive a minimised safety payload and pseudonymised telemetry. Never return `verbatim_ciphertext_ref`, original text, direct patient/user IDs, IP addresses, or full user-agent strings.

### 5.6 `POST /api/v1/workflow/simulate`

For authorised sandbox use only. It must never create production tickets or pages.

Request:

```ts
interface SimulateWorkflowRequest {
  text: string;
  score: number;
  featureKey: string;
  surveyType: SurveyType;
  locale?: string;
}
```

Response:

```ts
interface SimulateWorkflowResponse {
  simulationId: string;
  redactedText: string;
  redactions: Array<{ tag: string; count: number }>;
  clinicalGate: { flagged: boolean; reasonCodes: string[]; confidence: number };
  analysis: {
    sentiment: number;
    aspects: Array<{ aspect: string; polarity: number; confidence: number }>;
    classifierVersion: string;
  };
  routing: { action: RouteAction; priority: 'p0' | 'standard'; slaSeconds: number | null };
  stages: Array<{
    name: 'clinical_gate' | 'phi_scrubber' | 'absa_tagger' | 'routing_engine';
    status: 'passed' | 'flagged' | 'completed';
    durationMs: number;
  }>;
}
```

Rate-limit by user and organisation. Do not retain simulator input beyond the short processing window unless a user explicitly promotes it into an approved test fixture. Redact before model calls and before logs.

### 5.7 `POST /api/v1/responses/ingest`

Production machine-to-machine endpoint. Require a signed request, timestamp/nonce replay protection, and an idempotency key. Accept source metadata, score, touchpoint, telemetry references, and raw verbatim over the protected transport. Raw text must enter the restricted redaction boundary and must not be put on a general event bus.

Return `202 Accepted` with:

```json
{
  "responseId": "uuid",
  "processingStatus": "received",
  "statusUrl": "/api/v1/responses/uuid/status",
  "requestId": "req_..."
}
```

Process stages in order: synchronous safety pre-check, deterministic PHI scrub, optional approved NER scrub, ABSA/safety classification on redacted text, routing, persistence, audit event, then realtime notification. If redaction fails, quarantine the record and do not call downstream models.

### 5.8 `PATCH /api/v1/tickets/:id`

Request:

```ts
interface UpdateTicketRequest {
  status: TicketStatus;
  version: number;
  resolutionCode?: string;
  reason?: string;
}
```

Response: updated ticket DTO plus new `version`. Require role-based permission, validate state transitions, and use optimistic concurrency. Return `409` for stale versions. Examples of allowed transitions:

- `open -> contacted | escalated`
- `contacted -> resolved | escalated`
- `escalated -> contacted | resolved`
- reopening `resolved` requires an elevated permission and reason

A P0 ticket cannot be deleted or downgraded to a non-clinical ticket through this endpoint.

## 6. Error envelope and HTTP behavior

```ts
interface ApiError {
  error: {
    code: string;
    message: string;            // safe, user-presentable summary
    requestId: string;
    fieldErrors?: Record<string, string[]>;
    retryable: boolean;
  };
}
```

Use `400` invalid input, `401` unauthenticated, `403` unauthorised, `404` absent, `409` state/version conflict, `422` semantically invalid, `429` rate limited, and `500/503` safe operational failures. Add `Cache-Control: private, no-store` to user- or permission-dependent responses. Aggregate endpoints may use short private caching with explicit invalidation if their payload is identical for the same authorised scope.

## 7. Realtime contract

Expose an authenticated organisation-scoped stream, preferably SSE for one-way dashboard updates or WebSocket if the existing platform standard requires it:

`GET /api/v1/realtime/events`

```ts
type RealtimeEvent =
  | { type: 'response.processed'; id: string; occurredAt: IsoDateTime; affectedFeature: string }
  | { type: 'safety.p0_created'; id: string; occurredAt: IsoDateTime; reasonCodes: string[] }
  | { type: 'ticket.updated'; id: string; occurredAt: IsoDateTime; status: TicketStatus; version: number }
  | { type: 'metrics.invalidated'; occurredAt: IsoDateTime; scopes: Array<'executive' | 'features' | 'quadrant' | 'absa'> };
```

Do not send verbatim text, session references, user identifiers, or PHI tags through the realtime channel. The client should invalidate/refetch affected queries. Send heartbeat events, support reconnect with `Last-Event-ID`, and enforce the same role and tenant scope as REST.

## 8. State management and UI integration

Use TanStack Query for server state and React state/URL search parameters for view filters. Recommended behavior:

1. Normalise all filters into one `AnalyticsFilters` object.
2. Include every server-relevant filter in query keys.
3. Debounce search input by 300–500 ms; do not debounce select filters.
4. Use cursor pagination for verbatims and retain prior pages while fetching the next page.
5. On `PATCH /tickets/:id`, optimistically update only the matching ticket when transition validation is deterministic; roll back on error, then refetch the verbatim query.
6. On a P0 realtime event, immediately invalidate open-P0 and verbatim queries and show the existing safety alert treatment.
7. Format durations, dates, percentages, and NPS on the client; keep raw API values numeric.
8. Preserve the current empty, loading, partial-error, and permission-denied states independently per surface.
9. Never place returned verbatim or session telemetry in local storage, URL parameters, analytics events, or client error reports.

## 9. PHI redaction and security

### 9.1 Required masking rules

Before LLMs, ABSA, embeddings, analytics, logs, traces, error reporting, or UI delivery, replace detected values with stable category tags:

| Data | Replacement |
|---|---|
| Date of birth or explicit birth date | `[REDACTED_DOB]` |
| Patient/person name | `[REDACTED_NAME]` |
| Medical record number | `[REDACTED_MRN]` |
| NHS number | `[REDACTED_NHS_NUMBER]` |
| Email | `[REDACTED_EMAIL]` |
| Phone number | `[REDACTED_PHONE]` |
| Postal address/postcode when identifying | `[REDACTED_ADDRESS]` |
| Account/member identifier | `[REDACTED_MEMBER_ID]` |
| Other direct identifier | `[REDACTED_IDENTIFIER]` |

Use layered detection: deterministic patterns/checksums first, then an approved medical NER pass where allowed. NHS numbers must be normalised and checksum-validated, not matched as arbitrary 10-digit strings. MRN detection should combine keywords and organisation-specific formats. Names need contextual NER; do not rely on a static name list.

### 9.2 Processing order

```text
Ingress authentication and validation
  -> restricted clinical-risk pre-check (no persistence in logs)
  -> deterministic PHI redaction
  -> approved NER redaction
  -> redaction verification / leakage scan
  -> persist redacted analytics record
  -> call approved classifiers using redacted text only
  -> route and audit
```

The clinical-risk pre-check may inspect raw text inside the restricted boundary so urgent risk is not lost through redaction. Its output must be controlled reason codes, not copied raw text.

### 9.3 Access and operational controls

- Encrypt data in transit and at rest; isolate any raw-text vault with a separate key and service identity.
- Use least-privilege roles: dashboard viewer, customer-success operator, clinical-safety reviewer, and administrator.
- Enforce tenant/organisation scope server-side on every query and mutation.
- Keep raw-text access break-glass, time-limited, justified, and fully audited.
- Log actor, action, target IDs, result, and request ID, but never verbatim text or PHI.
- Apply retention/deletion policies separately to raw restricted data and redacted analytics data.
- Exclude all sensitive values from APM attributes, exception messages, prompt traces, and replay tools.
- Run automated redaction regression tests including DOB formats, NHS checksum cases, MRN variants, names, OCR spacing, Unicode, and adversarial prompt text.
- Treat text from users as data, never executable instructions. Classifiers must resist prompt injection.
- Make safety routing deterministic around approved rules; an LLM may add evidence but must not be the only P0 gate.

## 10. Automated routing rules

Evaluate safety before NPS tier. First matching mandatory safety rule wins.

### 10.1 P0 Clinical Page

Trigger when any high-confidence signal indicates possible patient harm, including:

- OCR decimal or unit mismatch (`4.7` vs `47`, `mg/dL` vs `mmol/L`);
- missed or incorrectly normalised abnormal marker;
- AI summary contradicts a radiologist, clinician, or source report;
- false reassurance, urgent symptom minimisation, or advice to defer necessary care;
- self-harm, acute emergency, medication danger, or other approved critical taxonomy code.

Action: create `p0_clinical` ticket, page clinical on-call, target acknowledgement within 15 minutes, suppress review/micro-poll actions, and audit all notifications. A positive NPS score does not override a safety flag.

### 10.2 24-hour Customer Success Ticket

Trigger when `nps_score` is 0–6 and no P0 condition applies. Create an open CS ticket with a 24-hour first-contact SLA. Attach only redacted text and approved telemetry.

### 10.3 Review Prompt

Trigger when `nps_score` is 9–10, no safety flag exists, consent/eligibility checks pass, and review-request frequency limits allow it. Queue an App Store or Trustpilot prompt based on platform and locale. Do not incentivise or selectively suppress eligible negative reviewers in violation of platform rules.

### 10.4 In-session Micro-poll

Trigger when `nps_score` is 7–8 and no safety flag exists. Ask one concise diagnostic question related to the highest-confidence aspect. Apply frequency caps and do not interrupt an active clinical-risk flow.

### 10.5 Routing pseudocode

```ts
function route(input: ClassifiedResponse): RoutingDecision {
  if (input.safety.flagged && input.safety.requiresImmediateReview) {
    return { action: 'p0_clinical_page', priority: 'p0', slaSeconds: 15 * 60 };
  }
  if (input.score <= 6) {
    return { action: 'cs_ticket', priority: 'standard', slaSeconds: 24 * 60 * 60 };
  }
  if (input.score >= 9 && input.reviewEligible) {
    return { action: 'review_prompt', priority: 'standard', slaSeconds: null };
  }
  return { action: 'micro_poll', priority: 'standard', slaSeconds: null };
}
```

## 11. Step-by-step Claude Code implementation guide

1. **Inspect the current repository and `docs/DESIGN.md`.** Preserve existing route/component names and visual behavior. Inventory the prototype types in `src/lib/nps-data.ts` before replacing imports.
2. **Create shared contracts and validation.** Add the interfaces above and runtime schemas for every request and response. Keep API DTOs separate from database row types.
3. **Create migrations.** Add enums, four canonical tables, ticket status history, processing audit records, indexes, constraints, grants, and row-level access policies in dependency order. Include explicit grants for every table.
4. **Seed dimensions only.** Seed stable feature touchpoints and approved taxonomy metadata. Do not seed production fact data through page-load code.
5. **Implement repositories and metric services.** Keep SQL/query code behind server-only modules. Unit-test NPS, response-rate denominators, ARD pairing, CCS, threshold status, close rate, and median contact time.
6. **Implement redaction first.** Build deterministic and NER layers, leakage verification, and a quarantine path before connecting any LLM or analytics provider. Add a corpus of PHI and OCR edge-case tests.
7. **Implement the safety classifier and router.** Use deterministic critical rules plus a versioned classifier. Store reason codes, confidence, and classifier version. Test safety precedence over every NPS tier.
8. **Implement ingestion.** Authenticate machine callers, validate schemas, enforce nonce/idempotency, run the pipeline, persist audit events, and return `202`. Keep raw input inside the restricted boundary.
9. **Implement read APIs.** Start with executive and feature metrics, then quadrant/ABSA, then cursor-paginated verbatims. Apply tenant, role, date, cohort, and privacy-threshold filters consistently.
10. **Implement ticket mutation.** Add state-machine validation, optimistic version checks, audit events, and SLA timestamps. Test forbidden transitions and concurrent updates.
11. **Implement realtime invalidation.** Publish identifier-only events after committed transactions. Authorise stream subscriptions and support reconnect without leaking text.
12. **Connect the UI.** Replace mock imports surface by surface with typed TanStack Query options. Keep mock fixtures in test/story files only. Use the current selected feature/aspect/theme state in API query parameters.
13. **Add resilient states.** Provide skeletons, empty results, safe errors, retry controls, stale-data indicators, and permission-denied messaging without exposing service details.
14. **Test end to end.** Cover ingest-to-P0, ingest-to-CS, promoter review, passive micro-poll, ticket update, realtime refresh, pagination stability, redaction leakage, role denial, tenant isolation, and low-volume suppression.
15. **Instrument safely.** Emit timings, counts, reason codes, model versions, and request IDs only. Add alerts for redaction failure, P0 delivery failure, ingestion backlog, classifier drift, and elevated hallucination rate.
16. **Roll out behind flags.** Run shadow comparisons against prototype calculations, reconcile differences, then enable reads before writes. Enable production routing only after clinical-safety sign-off and notification drills.

## 12. Acceptance criteria

- Every prototype surface loads from its specified endpoint and maintains current filters/interactions.
- NPS calculations reconcile to fixture data, including edge cases with zero eligible responses.
- The UI and its network responses never contain unredacted DOB, name, MRN, NHS number, or other direct identifiers.
- No external model request contains unredacted text.
- A safety signal always creates a P0 route regardless of score or sentiment.
- Detractors receive a 24-hour CS ticket when no P0 rule applies.
- Ticket updates enforce role, state transition, tenant scope, and version.
- Realtime events reveal identifiers/status only and trigger targeted UI refetches.
- Aggregate breakdowns below the privacy threshold are suppressed.
- All security-sensitive actions are audit logged without PHI.
- Contract, unit, integration, redaction, authorisation, and end-to-end tests pass.
