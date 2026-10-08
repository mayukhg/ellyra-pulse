import {
  HOTJAR_FUNNEL_STEPS,
  hasEvent,
  hasFrustrationSignals,
  isFrustratedSession,
  type AccountTier,
  type DeviceType,
  type FunnelStepKey,
  type SyntheticHotjarUser,
  type UserRole,
} from "@/test/fixtures/hotjarSyntheticData";

export type CohortFilters = {
  tier: AccountTier | "all";
  role: UserRole | "all";
  device: DeviceType | "all";
  frustration: "all" | "yes" | "no";
};

export const DEFAULT_COHORT_FILTERS: CohortFilters = {
  tier: "all",
  role: "all",
  device: "all",
  frustration: "all",
};

export function applyCohortFilters(users: readonly SyntheticHotjarUser[], f: CohortFilters) {
  return users.filter(
    (u) =>
      (f.tier === "all" || u.account_tier === f.tier) &&
      (f.role === "all" || u.user_role === f.role) &&
      (f.device === "all" || u.device === f.device) &&
      (f.frustration === "all" || hasFrustrationSignals(u) === (f.frustration === "yes")),
  );
}

const pct = (num: number, den: number) => (den === 0 ? 0 : (num / den) * 100);

export type HotjarKpis = {
  sessions: number;
  avgDurationSec: number;
  conversionPct: number;
  frustrationIndexPct: number;
};

export function computeKpis(users: readonly SyntheticHotjarUser[]): HotjarKpis {
  const n = users.length;
  const totalDuration = users.reduce((s, u) => s + u.sessionDurationSec, 0);
  return {
    sessions: n,
    avgDurationSec: n === 0 ? 0 : totalDuration / n,
    conversionPct: pct(users.filter((u) => hasEvent(u, "export_completed")).length, n),
    frustrationIndexPct: pct(users.filter(isFrustratedSession).length, n),
  };
}

export type FunnelStepMetrics = {
  key: FunnelStepKey;
  label: string;
  reached: number;
  /** Conversion from the previous step (100 for the first step). */
  stepConversionPct: number;
  /** Conversion from the first step. */
  overallPct: number;
  /** Users who reached the previous step but not this one (0 for the first step). */
  dropOff: number;
};

export function reachedStep(user: SyntheticHotjarUser, stepIndex: number) {
  const step = HOTJAR_FUNNEL_STEPS[stepIndex];
  return step ? hasEvent(user, step.event) : false;
}

export function computeFunnel(users: readonly SyntheticHotjarUser[]): FunnelStepMetrics[] {
  const counts = HOTJAR_FUNNEL_STEPS.map((_, i) => users.filter((u) => reachedStep(u, i)).length);
  const first = counts[0] ?? 0;
  return HOTJAR_FUNNEL_STEPS.map((step, i) => {
    const reached = counts[i] ?? 0;
    const prev = i === 0 ? reached : (counts[i - 1] ?? 0);
    return {
      key: step.key,
      label: step.label,
      reached,
      stepConversionPct: i === 0 ? 100 : pct(reached, prev),
      overallPct: pct(reached, first),
      dropOff: i === 0 ? 0 : prev - reached,
    };
  });
}

/** Users who reached step `stepIndex - 1` but not `stepIndex`. */
export function usersDroppedAt(users: readonly SyntheticHotjarUser[], key: FunnelStepKey) {
  const i = HOTJAR_FUNNEL_STEPS.findIndex((s) => s.key === key);
  if (i <= 0) return [];
  return users.filter((u) => reachedStep(u, i - 1) && !reachedStep(u, i));
}

export type ClickTargetMetrics = {
  target: string;
  clicks: number;
  deadClicks: number;
  rageClicks: number;
  total: number;
  deadRatePct: number;
};

export function computeClickDistribution(
  users: readonly SyntheticHotjarUser[],
): ClickTargetMetrics[] {
  const map = new Map<string, { clicks: number; deadClicks: number; rageClicks: number }>();
  for (const u of users) {
    for (const it of u.interactions) {
      if (it.kind !== "click" && it.kind !== "dead_click" && it.kind !== "rage_click") continue;
      const row = map.get(it.target) ?? { clicks: 0, deadClicks: 0, rageClicks: 0 };
      if (it.kind === "click") row.clicks++;
      else if (it.kind === "dead_click") row.deadClicks++;
      else row.rageClicks++;
      map.set(it.target, row);
    }
  }
  return [...map.entries()]
    .map(([target, r]) => {
      const total = r.clicks + r.deadClicks + r.rageClicks;
      return { target, ...r, total, deadRatePct: pct(r.deadClicks, total) };
    })
    .sort((a, b) => b.total - a.total);
}

export type FrustrationBadge = "Rage Click" | "Dead Click" | "U-Turn" | "Console Error";

export function frustrationBadges(user: SyntheticHotjarUser): FrustrationBadge[] {
  const s = user.frustrationSignals;
  const out: FrustrationBadge[] = [];
  if (s.rageClicks > 0) out.push("Rage Click");
  if (s.deadClicks > 0) out.push("Dead Click");
  if (s.uTurns > 0) out.push("U-Turn");
  if (s.jsErrors > 0) out.push("Console Error");
  return out;
}

export function formatDuration(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
