-- Cohort on each product-telemetry session, so funnel drop-off can be split
-- without joining only the sessions that completed a survey.

alter table fact_product_telemetry
  add column cohort_key text not null;
