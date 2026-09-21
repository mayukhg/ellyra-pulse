-- Canonical schema per docs/UI_INTEGRATION_REQUIREMENTS.md §3.
-- UUID primary keys, timestamptz in UTC, explicit FKs, DB constraints, append-only audit tables.
-- No PHI in any column here — verbatim_redacted is redacted text only; raw text lives in a
-- separately encrypted, separately keyed vault referenced by verbatim_ciphertext_ref and is
-- never joined by these tables.

create extension if not exists "pgcrypto";

create type survey_type as enum ('relational', 'transactional');
create type nps_tier as enum ('detractor', 'passive', 'promoter');
create type route_action as enum ('p0_clinical_page', 'cs_ticket', 'review_prompt', 'micro_poll');
create type processing_status as enum ('received', 'redacted', 'classified', 'routed', 'failed');
create type ticket_type as enum ('p0_clinical', 'customer_success');
create type ticket_status as enum ('open', 'contacted', 'resolved', 'escalated');
create type ticket_priority as enum ('p0', 'p1', 'standard');

-- 3.3 dim_feature_touchpoint -------------------------------------------------

create table dim_feature_touchpoint (
  feature_touchpoint_id uuid primary key default gen_random_uuid(),
  feature_key           text not null unique,
  feature_name          text not null,
  product_area          text not null,
  touchpoint_type       text not null,
  is_clinical           boolean not null default true,
  is_active             boolean not null default true,
  effective_from        timestamptz not null default now(),
  effective_to          timestamptz
);

insert into dim_feature_touchpoint
  (feature_key, feature_name, product_area, touchpoint_type, is_clinical)
values
  ('lab_blood_parser',      'Lab / Blood Report Parser', 'lab',     'report',      true),
  ('mri_imaging_insights',  'MRI / Imaging Insights',    'imaging', 'report',      true),
  ('symptom_chat_companion','Symptom Chat Companion',    'chat',    'conversation',true),
  ('gp_question_builder',   'GP Question Builder',       'gp_prep', 'builder',     false);

-- 3.2 dim_user_cohort ---------------------------------------------------------

create table dim_user_cohort (
  user_cohort_id     uuid primary key default gen_random_uuid(),
  cohort_key         text not null unique,
  cohort_name        text not null,
  plan_type          text,
  tenure_band        text,
  region_group       text,
  acquisition_channel text,
  is_active          boolean not null default true,
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz
);

-- 3.1 fact_nps_response --------------------------------------------------------

create table fact_nps_response (
  response_id             uuid primary key default gen_random_uuid(),
  external_response_id    text,
  source_system           text not null,
  received_at             timestamptz not null,
  survey_type             survey_type not null,
  nps_score               smallint not null check (nps_score between 0 and 10),
  nps_tier                nps_tier not null,
  feature_touchpoint_id   uuid references dim_feature_touchpoint (feature_touchpoint_id),
  user_cohort_id          uuid references dim_user_cohort (user_cohort_id),
  session_ref             text,
  channel                 text not null,
  locale                  text,
  response_eligible       boolean not null default true,
  verbatim_redacted       text,
  verbatim_ciphertext_ref text,
  redaction_tags          text[] not null default '{}',
  redaction_count         integer not null default 0,
  redaction_version       text not null,
  sentiment_score         numeric(4, 3) check (sentiment_score between -1 and 1),
  aspects                 jsonb not null default '[]',
  safety_flag             boolean not null default false,
  safety_reason_codes     text[] not null default '{}',
  safety_confidence       numeric(4, 3) check (safety_confidence between 0 and 1),
  route_action            route_action,
  model_version           text,
  classifier_version      text not null,
  processing_status       processing_status not null default 'received',
  created_at              timestamptz not null default now(),

  constraint fact_nps_response_external_id_unique
    unique (source_system, external_response_id)
);

create index fact_nps_response_received_at_idx on fact_nps_response (received_at desc);
create index fact_nps_response_feature_received_idx
  on fact_nps_response (feature_touchpoint_id, received_at desc);
create index fact_nps_response_tier_received_idx
  on fact_nps_response (nps_tier, received_at desc);
create index fact_nps_response_safety_flag_idx
  on fact_nps_response (received_at desc) where safety_flag;
create index fact_nps_response_aspects_gin_idx on fact_nps_response using gin (aspects);
create index fact_nps_response_redaction_tags_gin_idx
  on fact_nps_response using gin (redaction_tags);
-- Privacy-reviewed search vector over redacted text only.
create index fact_nps_response_search_idx
  on fact_nps_response using gin (to_tsvector('english', coalesce(verbatim_redacted, '')));

-- 3.4 fact_closed_loop_ticket ---------------------------------------------------

create table fact_closed_loop_ticket (
  ticket_id        uuid primary key default gen_random_uuid(),
  response_id      uuid not null references fact_nps_response (response_id),
  ticket_type      ticket_type not null,
  status           ticket_status not null default 'open',
  priority         ticket_priority not null,
  owner_team       text not null,
  owner_id         uuid,
  created_at       timestamptz not null default now(),
  first_contact_at timestamptz,
  resolved_at      timestamptz,
  sla_due_at       timestamptz not null,
  sla_breached_at  timestamptz,
  resolution_code  text,
  last_updated_by  uuid not null,
  version          integer not null default 0,
  updated_at       timestamptz not null default now()
);

create index fact_closed_loop_ticket_response_idx on fact_closed_loop_ticket (response_id);
create index fact_closed_loop_ticket_status_idx on fact_closed_loop_ticket (status, sla_due_at);

-- Append-only ticket state history — never overwrite, per §3.4.
create table ticket_status_event (
  event_id     uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references fact_closed_loop_ticket (ticket_id),
  old_status   ticket_status,
  new_status   ticket_status not null,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid not null,
  request_id   text not null,
  reason       text
);

create index ticket_status_event_ticket_idx on ticket_status_event (ticket_id, occurred_at);

-- Append-only processing audit trail (ingestion guide step 3): one row per pipeline stage
-- transition for a response, so redaction/classification/routing decisions are reconstructable
-- without ever storing raw text here.
create table response_processing_audit (
  audit_id     uuid primary key default gen_random_uuid(),
  response_id  uuid not null references fact_nps_response (response_id),
  stage        text not null check (
    stage in ('ingress', 'clinical_pre_check', 'phi_redaction', 'ner_redaction',
              'leakage_scan', 'classification', 'routing', 'notification')
  ),
  status       text not null check (status in ('passed', 'flagged', 'failed', 'completed')),
  detail_codes text[] not null default '{}', -- controlled vocabulary only, never raw text
  occurred_at  timestamptz not null default now(),
  request_id   text not null
);

create index response_processing_audit_response_idx
  on response_processing_audit (response_id, occurred_at);
