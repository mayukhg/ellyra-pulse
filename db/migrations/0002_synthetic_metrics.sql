-- Columns and facts the quota corpus needs. Apply after 0001_init.sql.
-- Quarantine stores reason codes only. Raw text is never written here.

create table fact_clinical_session (
  session_id         uuid primary key,
  started_at         timestamptz not null,
  feature_key        text not null,
  user_cohort_id     uuid references dim_user_cohort (user_cohort_id),
  eligible_clinical  boolean not null,
  mismatch_codes     text[] not null default '{}',
  harm_codes         text[] not null default '{}'
);

create index fact_clinical_session_started_idx on fact_clinical_session (started_at desc);

create table fact_survey_invitation (
  invitation_id uuid primary key,
  session_id    uuid not null references fact_clinical_session (session_id),
  delivered_at  timestamptz not null,
  eligible      boolean not null,
  feature_key   text not null
);

create index fact_survey_invitation_delivered_idx on fact_survey_invitation (delivered_at desc);

alter table fact_nps_response
  add column invitation_id uuid references fact_survey_invitation (invitation_id),
  add column session_id uuid references fact_clinical_session (session_id),
  add column anxiety_pre smallint,
  add column anxiety_post smallint,
  add column anxiety_pair_valid boolean not null default false,
  add column comprehension_applicable boolean not null default false,
  add column understood_without_search boolean,
  add column disclaimer_exposed boolean not null default false,
  add column disclaimer_polarity smallint,
  add constraint fact_nps_response_disclaimer_polarity_check
    check (disclaimer_polarity is null or disclaimer_polarity between -1 and 1);

-- A session-only P0 has no NPS row. The existing foreign key already allows NULL
-- once the NOT NULL constraint is removed.
alter table fact_closed_loop_ticket alter column response_id drop not null;
alter table fact_closed_loop_ticket
  add column session_id uuid references fact_clinical_session (session_id);

create table fact_page_event (
  page_event_id    uuid primary key,
  ticket_id        uuid not null references fact_closed_loop_ticket (ticket_id),
  delivered        boolean not null,
  sent_at          timestamptz not null,
  acknowledged_at  timestamptz,
  detail_code      text not null
);

create table fact_redaction_quarantine (
  quarantine_id uuid primary key,
  occurred_at   timestamptz not null,
  stage         text not null,
  status        text not null,
  detail_codes  text[] not null default '{}'
);

create table fact_theme_override (
  override_id uuid primary key,
  feature_key text not null,
  aspect      text not null,
  critical    boolean not null,
  note        text not null,
  unique (feature_key, aspect)
);

create table fact_product_telemetry (
  session_id          uuid primary key,
  device              text not null,
  rage_clicks         integer not null,
  dead_clicks         integer not null,
  events              text[] not null,
  linked_response_id  uuid references fact_nps_response (response_id)
);
