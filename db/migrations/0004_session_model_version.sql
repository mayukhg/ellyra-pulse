-- Serving model on each clinical session, so the hallucination flag rate can be
-- split when more than one Gemini version is in the window.

alter table fact_clinical_session
  add column model_version text not null;
