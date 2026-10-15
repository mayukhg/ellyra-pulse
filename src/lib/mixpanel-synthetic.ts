/**
 * Deterministic synthetic Mixpanel events for Ellyra Pulse (90-day backfill).
 * Stable $insert_id values (seed + event + day + seq) make re-imports idempotent.
 */
import { createHash } from "node:crypto";
import type { MixpanelEventName } from "@/lib/mixpanel-events";
import type { MixpanelImportEvent } from "@/lib/mixpanel-history";

export type SyntheticUser = {
  distinct_id: string;
  name: string;
  email: string;
  organization_id: string;
  role: "admin" | "clinical_officer" | "analyst";
  plan: string;
  companions_managed: number;
  created_at: string;
  churned: boolean;
};

export type CompanionTier = "healthy" | "at_risk" | "suspended" | "new";

export type SyntheticCompanion = {
  companion_id: string;
  companion_type: string;
  organization_id: string;
  tier: CompanionTier;
  added_day_offset: number;
  suspended_day_offset: number | null;
};

export type SyntheticBundle = {
  users: SyntheticUser[];
  companions: SyntheticCompanion[];
  events: MixpanelImportEvent[];
  peopleUpdates: MixpanelPeopleUpdate[];
};

export type MixpanelPeopleUpdate = {
  $token?: string;
  $distinct_id: string;
  $ip: 0;
  $time: number;
  $set: Record<string, string | number | boolean>;
};

const ROLES = ["admin", "clinical_officer", "analyst"] as const;
const SEGMENTS = ["chronic_care", "acute_episode", "wellness", "post_discharge"] as const;
const CHANNELS = ["email", "in-app", "sms"] as const;
const EVENT_TYPES = ["hallucination_flag", "distress_signal", "medication_conflict", "self_harm_risk"] as const;
const GATE_TYPES = ["clinical_gate", "toxicity_gate", "phi_gate"] as const;
const ALERT_CHANNELS = ["pagerduty", "slack", "email", "sms"] as const;
const VIEWS = ["scorecard", "rootcause", "verbatims", "simulator"] as const;
const FILTER_TYPES = ["feature", "aspect", "theme", "severity"] as const;
const METRICS = ["overall_nps", "anxiety_reduction", "clinical_trust", "frustration_share"] as const;

const ORG_NAMES = [
  { id: "org_northstar_health", plan: "enterprise" },
  { id: "org_riverside_clinic", plan: "growth" },
  { id: "org_summit_care", plan: "enterprise" },
  { id: "org_lakeside_medical", plan: "growth" },
  { id: "org_churned_pilot", plan: "pilot" },
] as const;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)]!;
}

function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function insertId(parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function uuidFromParts(parts: Array<string | number>): string {
  const hex = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function dayMs(dayStart: number, rand: () => number, endCap: number): number {
  return Math.min(endCap, dayStart + Math.floor(rand() * 20 * 60 * 60 * 1000));
}

function sentimentCategory(score: number): "positive" | "neutral" | "negative" | "critical" {
  if (score <= 3) return "critical";
  if (score <= 6) return "negative";
  if (score <= 8) return "neutral";
  return "positive";
}

function npsForTier(tier: CompanionTier, rand: () => number): number {
  if (tier === "healthy") return randInt(rand, 45, 70);
  if (tier === "at_risk") return randInt(rand, 10, 30);
  if (tier === "suspended") return randInt(rand, -20, 15);
  return randInt(rand, 20, 55);
}

function scoreForTier(tier: CompanionTier, rand: () => number): number {
  if (tier === "healthy") {
    const roll = rand();
    if (roll < 0.55) return randInt(rand, 9, 10);
    if (roll < 0.85) return randInt(rand, 7, 8);
    return randInt(rand, 4, 6);
  }
  if (tier === "at_risk") {
    const roll = rand();
    if (roll < 0.45) return randInt(rand, 0, 6);
    if (roll < 0.75) return randInt(rand, 7, 8);
    return randInt(rand, 9, 10);
  }
  if (tier === "suspended") return randInt(rand, 0, 5);
  return randInt(rand, 5, 9);
}

export function buildSyntheticUsers(seed = 20261015): SyntheticUser[] {
  const rand = mulberry32(seed);
  const users: SyntheticUser[] = [];
  let userIndex = 0;

  for (let orgIdx = 0; orgIdx < ORG_NAMES.length; orgIdx += 1) {
    const org = ORG_NAMES[orgIdx]!;
    const churned = org.id === "org_churned_pilot";
    const count = churned ? 2 : randInt(rand, 3, 5);
    for (let i = 0; i < count; i += 1) {
      userIndex += 1;
      const distinct_id = uuidFromParts(["user", seed, org.id, userIndex]);
      const role = churned ? "admin" : pick(rand, ROLES);
      const createdDay = churned ? randInt(rand, 70, 85) : randInt(rand, 0, 20);
      users.push({
        distinct_id,
        name: `Synth User ${userIndex}`,
        email: `synth.user${userIndex}@example.invalid`,
        organization_id: org.id,
        role,
        plan: org.plan,
        companions_managed: churned ? 0 : randInt(rand, 1, 4),
        created_at: "", // filled once timeline is known
        churned,
        // temporary field storage via createdDay encoded below
      });
      // stash day offset in created_at temporarily as number string; rewritten in build
      users[users.length - 1]!.created_at = String(createdDay);
    }
  }

  // Ensure exactly 20 users: pad or trim active orgs
  while (users.length < 20) {
    userIndex += 1;
    const org = ORG_NAMES[userIndex % 4]!;
    users.push({
      distinct_id: uuidFromParts(["user", seed, "pad", userIndex]),
      name: `Synth User ${userIndex}`,
      email: `synth.user${userIndex}@example.invalid`,
      organization_id: org.id,
      role: pick(rand, ROLES),
      plan: org.plan,
      companions_managed: randInt(rand, 1, 3),
      created_at: String(randInt(rand, 0, 15)),
      churned: false,
    });
  }
  return users.slice(0, 20);
}

export function buildSyntheticCompanions(seed = 20261015): SyntheticCompanion[] {
  const rand = mulberry32(seed + 99);
  const activeOrgs = ORG_NAMES.filter((o) => o.id !== "org_churned_pilot");
  const tiers: CompanionTier[] = [
    "healthy",
    "healthy",
    "healthy",
    "at_risk",
    "at_risk",
    "at_risk",
    "suspended",
    "suspended",
    "new",
    "new",
    "new",
    "new",
  ];
  const types = [
    "symptom_chat",
    "lab_explainer",
    "imaging_insights",
    "medication_coach",
    "care_navigator",
  ] as const;

  return tiers.map((tier, i) => {
    const org = activeOrgs[i % activeOrgs.length]!;
    const added =
      tier === "new" ? randInt(rand, 60, 89) : tier === "suspended" ? randInt(rand, 5, 25) : randInt(rand, 0, 30);
    return {
      companion_id: uuidFromParts(["companion", seed, tier, i]),
      companion_type: pick(rand, types),
      organization_id: org.id,
      tier,
      added_day_offset: added,
      suspended_day_offset: tier === "suspended" ? randInt(rand, 55, 65) : null,
    };
  });
}

export function buildSyntheticMixpanelData(
  options: { days?: number; now?: number; seed?: number } = {},
): SyntheticBundle {
  const days = options.days ?? 90;
  const now = options.now ?? Date.now();
  const seed = options.seed ?? 20261015;
  const rand = mulberry32(seed);
  const end = now - 60_000;
  const start = end - days * 24 * 60 * 60 * 1000;

  const users = buildSyntheticUsers(seed);
  const companions = buildSyntheticCompanions(seed);
  const events: MixpanelImportEvent[] = [];
  const peopleUpdates: MixpanelPeopleUpdate[] = [];
  let sequence = 0;

  const activeUsers = users.filter((u) => !u.churned);
  const usersByOrg = (orgId: string) => users.filter((u) => u.organization_id === orgId);

  const push = (
    event: MixpanelEventName | "$identify",
    when: number,
    distinctId: string,
    properties: Record<string, string | number | boolean>,
  ) => {
    const timeSec = Math.floor(when / 1000);
    events.push({
      event,
      properties: {
        ...properties,
        time: timeSec,
        distinct_id: distinctId,
        $insert_id: insertId([seed, event, timeSec, distinctId, sequence++]),
        ip: "0",
      },
    });
  };

  // Finalize created_at ISO and emit signup / identify / people
  for (const user of users) {
    const dayOffset = Number(user.created_at) || 0;
    const signupAt = Math.min(end, start + dayOffset * 24 * 60 * 60 * 1000 + randInt(rand, 0, 8) * 3_600_000);
    user.created_at = new Date(signupAt).toISOString();

    push("user_signed_up", signupAt, user.distinct_id, {
      plan: user.plan,
      organization_id: user.organization_id,
      role: user.role,
    });
    push("$identify", signupAt + 1, user.distinct_id, {
      $identified_id: user.distinct_id,
      $anon_id: uuidFromParts(["anon", user.distinct_id]),
    });
    peopleUpdates.push({
      $distinct_id: user.distinct_id,
      $ip: 0,
      $time: Math.floor(signupAt / 1000),
      $set: {
        $name: user.name,
        $email: user.email,
        organization_id: user.organization_id,
        role: user.role,
        plan: user.plan,
        companions_managed: user.companions_managed,
        created_at: user.created_at,
      },
    });

    if (!user.churned) {
      // A few logins after signup
      for (let login = 0; login < randInt(rand, 2, 6); login += 1) {
        const loginAt = Math.min(
          end,
          signupAt + randInt(rand, 1, Math.max(2, days - dayOffset - 1)) * 24 * 60 * 60 * 1000,
        );
        push("user_logged_in", loginAt, user.distinct_id, {
          organization_id: user.organization_id,
          role: user.role,
          login_method: rand() < 0.7 ? "email" : "sso",
        });
      }
      if (user.role === "admin" && rand() < 0.6) {
        push("user_invited", signupAt + 86_400_000, user.distinct_id, {
          invitee_role: pick(rand, ROLES),
          organization_id: user.organization_id,
        });
      }
      if (rand() < 0.8) {
        push("onboarding_completed", signupAt + randInt(rand, 1, 5) * 3_600_000, user.distinct_id, {
          time_to_complete_seconds: randInt(rand, 180, 2400),
          companions_configured: user.companions_managed,
        });
      }
    }
  }

  // Companion lifecycle
  for (const companion of companions) {
    const orgUsers = usersByOrg(companion.organization_id).filter((u) => !u.churned);
    const actor = pick(rand, orgUsers.length > 0 ? orgUsers : activeUsers);
    const addedAt = Math.min(end, start + companion.added_day_offset * 24 * 60 * 60 * 1000);
    push("companion_added", addedAt, actor.distinct_id, {
      companion_id: companion.companion_id,
      companion_type: companion.companion_type,
      organization_id: companion.organization_id,
    });
    push("companion_configured", addedAt + 3_600_000, actor.distinct_id, {
      companion_id: companion.companion_id,
      config_type: pick(rand, ["safety_thresholds", "nps_cadence", "tone_profile", "routing_rules"]),
    });
    if (companion.suspended_day_offset != null) {
      const suspendedAt = Math.min(end, start + companion.suspended_day_offset * 24 * 60 * 60 * 1000);
      push("companion_suspended", suspendedAt, actor.distinct_id, {
        companion_id: companion.companion_id,
        reason: "critical_adverse_event",
        triggered_by: "auto",
      });
      push("safety_review_completed", suspendedAt + 2 * 3_600_000, actor.distinct_id, {
        companion_id: companion.companion_id,
        resolution_type: "suspended",
        time_to_resolve_minutes: randInt(rand, 15, 240),
      });
    }
  }

  const activeCompanionsForDay = (day: number) =>
    companions.filter((c) => {
      if (c.added_day_offset > day) return false;
      if (c.suspended_day_offset != null && day >= c.suspended_day_offset) return false;
      return true;
    });

  for (let day = 0; day < days; day += 1) {
    const dayStart = start + day * 24 * 60 * 60 * 1000;
    const dayCompanions = activeCompanionsForDay(day);
    if (dayCompanions.length === 0) continue;

    // sentiment_batch_ingested: 5–15 / day
    const batches = randInt(rand, 5, 15);
    for (let b = 0; b < batches; b += 1) {
      const companion = pick(rand, dayCompanions);
      const orgActors = usersByOrg(companion.organization_id).filter((u) => !u.churned);
      const actor = pick(rand, orgActors.length > 0 ? orgActors : activeUsers);
      const when = dayMs(dayStart, rand, end);
      const recordCount = randInt(rand, 50, 500);
      const phiCount = randInt(rand, 0, Math.floor(recordCount * 0.08));
      push("sentiment_batch_ingested", when, actor.distinct_id, {
        companion_id: companion.companion_id,
        record_count: recordCount,
        phi_redacted_count: phiCount,
        source: pick(rand, ["ehr_export", "companion_runtime", "survey_vendor"]),
      });
      // Sample a few record-level events per batch (not every row — keeps volume realistic)
      const sampleRecords = randInt(rand, 1, 3);
      for (let r = 0; r < sampleRecords; r += 1) {
        const score = scoreForTier(companion.tier, rand);
        push("sentiment_record_created", when + r * 1000, actor.distinct_id, {
          companion_id: companion.companion_id,
          sentiment_score: score,
          sentiment_category: sentimentCategory(score),
          phi_redaction_applied: rand() < 0.25,
        });
        if (rand() < 0.2) {
          push("phi_redaction_triggered", when + r * 1000 + 10, actor.distinct_id, {
            companion_id: companion.companion_id,
            field_count_redacted: randInt(rand, 1, 6),
          });
        }
      }
    }

    // nps_response_received: 10–30 / day
    const npsCount = randInt(rand, 10, 30);
    for (let i = 0; i < npsCount; i += 1) {
      const companion = pick(rand, dayCompanions);
      const actor = pick(rand, activeUsers);
      const when = dayMs(dayStart, rand, end);
      const score = scoreForTier(companion.tier, rand);
      push("nps_survey_sent", when - 3_600_000, actor.distinct_id, {
        companion_id: companion.companion_id,
        patient_segment: pick(rand, SEGMENTS),
        channel: pick(rand, CHANNELS),
      });
      push("nps_response_received", when, actor.distinct_id, {
        companion_id: companion.companion_id,
        nps_score: score,
        patient_segment: pick(rand, SEGMENTS),
        response_time_hours: randInt(rand, 1, 72),
      });
    }

    // Daily NPS rollup for a subset of companions
    if (day % 7 === 6) {
      for (const companion of dayCompanions) {
        if (rand() > 0.5) continue;
        const actor = pick(rand, activeUsers);
        const nps = npsForTier(companion.tier, rand);
        const promoters = randInt(rand, 20, 80);
        const detractors = randInt(rand, 5, 40);
        const passives = randInt(rand, 10, 40);
        push("nps_score_calculated", dayMs(dayStart, rand, end), actor.distinct_id, {
          companion_id: companion.companion_id,
          nps_score: nps,
          period: "weekly",
          promoters,
          detractors,
          passives,
        });
      }
    }

    // dashboard_viewed: 8–25 / day
    const dashViews = randInt(rand, 8, 25);
    for (let i = 0; i < dashViews; i += 1) {
      const actor = pick(rand, activeUsers);
      const companion = pick(rand, dayCompanions);
      const when = dayMs(dayStart, rand, end);
      const view = pick(rand, VIEWS);
      push("dashboard_viewed", when, actor.distinct_id, {
        view_name: view,
        companion_id: companion.companion_id,
        date_range_selected: pick(rand, ["rolling_7_days", "rolling_30_days", "quarter_to_date"]),
      });
      if (rand() < 0.55) {
        push("filter_applied", when + 2000, actor.distinct_id, {
          filter_type: pick(rand, FILTER_TYPES),
          filter_value: pick(rand, ["clinical_trust", "anxiety", "high", "lab_blood_parser"]),
          view_name: view,
        });
      }
      if (rand() < 0.35) {
        push("trend_analyzed", when + 4000, actor.distinct_id, {
          metric_name: pick(rand, METRICS),
          companion_id: companion.companion_id,
          time_range: pick(rand, ["7d", "30d", "90d"]),
        });
      }
      if (rand() < 0.08) {
        push("report_exported", when + 6000, actor.distinct_id, {
          report_type: pick(rand, ["executive_nps", "safety_digest", "verbatim_pack"]),
          format: pick(rand, ["pdf", "csv", "json"] as const),
          companion_id: companion.companion_id,
        });
      }
    }

    // adverse_event_detected: 0–2 / day, weighted to at-risk
    const adverseCount = rand() < 0.55 ? 0 : rand() < 0.85 ? 1 : 2;
    for (let i = 0; i < adverseCount; i += 1) {
      const weighted =
        dayCompanions.filter((c) => c.tier === "at_risk" || c.tier === "suspended").length > 0 &&
        rand() < 0.75
          ? dayCompanions.filter((c) => c.tier === "at_risk" || c.tier === "new")
          : dayCompanions;
      const pool = weighted.length > 0 ? weighted : dayCompanions;
      const companion = pick(rand, pool);
      const actor = pick(rand, activeUsers);
      const when = dayMs(dayStart, rand, end);
      const severity =
        companion.tier === "at_risk"
          ? pick(rand, ["medium", "high", "critical"] as const)
          : pick(rand, ["low", "medium", "high"] as const);
      push("adverse_event_detected", when, actor.distinct_id, {
        companion_id: companion.companion_id,
        severity,
        event_type: pick(rand, EVENT_TYPES),
        detection_method: rand() < 0.85 ? "auto" : "manual",
      });
      if (rand() < 0.7) {
        push("safety_gate_triggered", when + 1500, actor.distinct_id, {
          companion_id: companion.companion_id,
          severity,
          gate_type: pick(rand, GATE_TYPES),
          auto_or_manual: "auto",
        });
        if ((severity === "high" || severity === "critical") && rand() < 0.6) {
          push("oncall_alert_sent", when + 3000, actor.distinct_id, {
            companion_id: companion.companion_id,
            severity,
            alert_channel: pick(rand, ALERT_CHANNELS),
            recipient_role: "clinical_officer",
          });
          if (rand() < 0.4) {
            push("safety_review_completed", when + 86_400_000, actor.distinct_id, {
              companion_id: companion.companion_id,
              resolution_type: pick(rand, ["reinstated", "monitoring", "suspended"] as const),
              time_to_resolve_minutes: randInt(rand, 20, 720),
            });
            if (rand() < 0.25 && companion.tier !== "suspended") {
              push("companion_reinstated", when + 90_000_000, actor.distinct_id, {
                companion_id: companion.companion_id,
                organization_id: companion.organization_id,
              });
            }
          }
        }
      }
    }
  }

  events.sort((a, b) => a.properties.time - b.properties.time);
  return { users, companions, events, peopleUpdates };
}

export function firstEventsPerType(
  events: MixpanelImportEvent[],
  limit = 5,
): Record<string, MixpanelImportEvent[]> {
  const out: Record<string, MixpanelImportEvent[]> = {};
  for (const event of events) {
    const bucket = out[event.event] ?? [];
    if (bucket.length < limit) {
      bucket.push(event);
      out[event.event] = bucket;
    }
  }
  return out;
}

export { chunkEvents } from "@/lib/mixpanel-history";
