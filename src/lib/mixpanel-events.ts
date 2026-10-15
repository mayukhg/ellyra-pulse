/**
 * Typed Mixpanel event catalogue for Ellyra Pulse.
 * Property shapes are the contract for client, server, and synthetic import.
 * Never put PHI (verbatim, names, emails, NHS numbers) in event properties.
 */

export type LoginMethod = "email" | "sso";
export type SentimentCategory = "positive" | "neutral" | "negative" | "critical";
export type NpsChannel = "email" | "in-app" | "sms";
export type SafetySeverity = "low" | "medium" | "high" | "critical";
export type TriggerMode = "auto" | "manual";
export type AlertChannel = "pagerduty" | "slack" | "email" | "sms";
export type ResolutionType = "reinstated" | "suspended" | "monitoring";
export type ExportFormat = "pdf" | "csv" | "json";

export type UserSignedUpProps = {
  plan: string;
  organization_id: string;
  role: string;
};

export type UserLoggedInProps = {
  organization_id: string;
  role: string;
  login_method: LoginMethod;
};

export type UserInvitedProps = {
  invitee_role: string;
  organization_id: string;
};

export type OnboardingCompletedProps = {
  time_to_complete_seconds: number;
  companions_configured: number;
};

export type CompanionAddedProps = {
  companion_id: string;
  companion_type: string;
  organization_id: string;
};

export type CompanionConfiguredProps = {
  companion_id: string;
  config_type: string;
};

export type CompanionSuspendedProps = {
  companion_id: string;
  reason: string;
  triggered_by: TriggerMode;
};

export type CompanionReinstatedProps = {
  companion_id: string;
  organization_id: string;
};

export type SentimentBatchIngestedProps = {
  companion_id: string;
  record_count: number;
  phi_redacted_count: number;
  source: string;
};

export type SentimentRecordCreatedProps = {
  companion_id: string;
  sentiment_score: number;
  sentiment_category: SentimentCategory;
  phi_redaction_applied: boolean;
};

export type PhiRedactionTriggeredProps = {
  companion_id: string;
  field_count_redacted: number;
};

export type NpsSurveySentProps = {
  companion_id: string;
  patient_segment: string;
  channel: NpsChannel;
};

export type NpsResponseReceivedProps = {
  companion_id: string;
  nps_score: number;
  patient_segment: string;
  response_time_hours: number;
};

export type NpsScoreCalculatedProps = {
  companion_id: string;
  nps_score: number;
  period: string;
  promoters: number;
  detractors: number;
  passives: number;
};

export type AdverseEventDetectedProps = {
  companion_id: string;
  severity: SafetySeverity;
  event_type: string;
  detection_method: TriggerMode;
};

export type SafetyGateTriggeredProps = {
  companion_id: string;
  severity: SafetySeverity;
  gate_type: string;
  auto_or_manual: TriggerMode;
};

export type OncallAlertSentProps = {
  companion_id: string;
  severity: string;
  alert_channel: AlertChannel;
  recipient_role: string;
};

export type SafetyReviewCompletedProps = {
  companion_id: string;
  resolution_type: ResolutionType;
  time_to_resolve_minutes: number;
};

export type DashboardViewedProps = {
  view_name: string;
  companion_id: string;
  date_range_selected: string;
};

export type ReportExportedProps = {
  report_type: string;
  format: ExportFormat;
  companion_id: string;
};

export type FilterAppliedProps = {
  filter_type: string;
  filter_value: string;
  view_name: string;
};

export type TrendAnalyzedProps = {
  metric_name: string;
  companion_id: string;
  time_range: string;
};

/** Event name → property shape. Use with typed `track()`. */
export type MixpanelEventMap = {
  user_signed_up: UserSignedUpProps;
  user_logged_in: UserLoggedInProps;
  user_invited: UserInvitedProps;
  onboarding_completed: OnboardingCompletedProps;
  companion_added: CompanionAddedProps;
  companion_configured: CompanionConfiguredProps;
  companion_suspended: CompanionSuspendedProps;
  companion_reinstated: CompanionReinstatedProps;
  sentiment_batch_ingested: SentimentBatchIngestedProps;
  sentiment_record_created: SentimentRecordCreatedProps;
  phi_redaction_triggered: PhiRedactionTriggeredProps;
  nps_survey_sent: NpsSurveySentProps;
  nps_response_received: NpsResponseReceivedProps;
  nps_score_calculated: NpsScoreCalculatedProps;
  adverse_event_detected: AdverseEventDetectedProps;
  safety_gate_triggered: SafetyGateTriggeredProps;
  oncall_alert_sent: OncallAlertSentProps;
  safety_review_completed: SafetyReviewCompletedProps;
  dashboard_viewed: DashboardViewedProps;
  report_exported: ReportExportedProps;
  filter_applied: FilterAppliedProps;
  trend_analyzed: TrendAnalyzedProps;
};

export type MixpanelEventName = keyof MixpanelEventMap;

/** People profile properties set on identify(). */
export type MixpanelUserProperties = {
  $name?: string;
  $email?: string;
  organization_id?: string;
  role?: string;
  plan?: string;
  companions_managed?: number;
  created_at?: string;
};

export const MIXPANEL_EVENT_NAMES = Object.keys({
  user_signed_up: 1,
  user_logged_in: 1,
  user_invited: 1,
  onboarding_completed: 1,
  companion_added: 1,
  companion_configured: 1,
  companion_suspended: 1,
  companion_reinstated: 1,
  sentiment_batch_ingested: 1,
  sentiment_record_created: 1,
  phi_redaction_triggered: 1,
  nps_survey_sent: 1,
  nps_response_received: 1,
  nps_score_calculated: 1,
  adverse_event_detected: 1,
  safety_gate_triggered: 1,
  oncall_alert_sent: 1,
  safety_review_completed: 1,
  dashboard_viewed: 1,
  report_exported: 1,
  filter_applied: 1,
  trend_analyzed: 1,
} satisfies Record<MixpanelEventName, 1>) as MixpanelEventName[];
