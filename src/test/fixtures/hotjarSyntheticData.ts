/**
 * Synthetic Hotjar-style behavioural telemetry for UX simulation, the dev QA harness and the
 * /dev/hotjar-insights dashboard. Fully deterministic (seeded PRNG, no external deps): user `i`
 * is identical regardless of `count`, so fixtures are stable across tests and reloads.
 *
 * Nothing here is real user data. Every "sensitive" value is a synthetic stand-in used to verify
 * that `data-hj-suppress` containers redact correctly in recordings.
 */

export type AccountTier = "free" | "starter" | "pro" | "enterprise";
export type UserRole = "admin" | "operator" | "viewer";
export type DeviceType = "desktop" | "mobile" | "tablet";

export type LifecycleEventName =
  | "session_authenticated"
  | "dashboard_viewed"
  | "filter_applied"
  | "export_initiated"
  | "export_completed"
  | "export_failed";

export type FrustrationSignals = {
  rageClicks: number;
  deadClicks: number;
  uTurns: number;
  jsErrors: number;
};

export type SyntheticLifecycleEvent = {
  name: LifecycleEventName;
  /** Seconds from session start. */
  atSec: number;
};

export type InteractionKind = "click" | "dead_click" | "rage_click" | "u_turn" | "js_error";

export type SyntheticInteraction = {
  kind: InteractionKind;
  /** CSS-ish selector label of the UI element (or route / error source). */
  target: string;
  atSec: number;
};

export type SyntheticMaskedContext = {
  clientIp: string;
  apiKey: string;
  email: string;
};

export type SyntheticHotjarUser = {
  userIdHash: string;
  account_tier: AccountTier;
  user_role: UserRole;
  device: DeviceType;
  sessionDurationSec: number;
  startedAt: string;
  frustrationSignals: FrustrationSignals;
  /** Ordered lifecycle trace; always starts with session_authenticated. */
  events: SyntheticLifecycleEvent[];
  /** Ordered click / frustration interactions, consistent with frustrationSignals counts. */
  interactions: SyntheticInteraction[];
  /** Synthetic secrets/PII — must only ever be rendered inside data-hj-suppress containers. */
  maskedContext: SyntheticMaskedContext;
};

export type GenerateOptions = { seed?: number };

export const DEFAULT_SYNTHETIC_SEED = 1058676;

export const ACCOUNT_TIERS: readonly AccountTier[] = ["free", "starter", "pro", "enterprise"];
export const USER_ROLES: readonly UserRole[] = ["admin", "operator", "viewer"];
export const DEVICE_TYPES: readonly DeviceType[] = ["desktop", "mobile", "tablet"];

export const HOTJAR_FUNNEL_STEPS = [
  { key: "session_start", label: "Session Start", event: "session_authenticated" },
  { key: "dashboard_view", label: "Dashboard View", event: "dashboard_viewed" },
  { key: "filter_applied", label: "Filter Applied", event: "filter_applied" },
  { key: "telemetry_exported", label: "Telemetry Exported", event: "export_completed" },
] as const satisfies readonly { key: string; label: string; event: LifecycleEventName }[];

export type FunnelStepKey = (typeof HOTJAR_FUNNEL_STEPS)[number]["key"];

export const UI_TARGETS = [
  "nav.tab-scorecard",
  "nav.tab-verbatims",
  "select.date-range",
  "chip.feature-filter",
  "button.export-csv",
  "table.row-expand",
  "card.kpi-nps",
  "legend.quadrant-toggle",
  "icon.metric-info",
  "button.page-on-call",
] as const;

/** Static synthetic payloads for privacy-masking tests. All values are fake by construction. */
export const SYNTHETIC_MASKING_PAYLOADS = {
  apiKey: "sk_live_synth_4f9a1c7e2b8d6035a1e9",
  sessionToken: "eyJhbGciOiJIUzI1NiJ9.synthetic-session.c2lnbmF0dXJl",
  clusterIp: "10.0.42.17",
  databaseUrl: "postgres://synth_user:synth_pw@10.0.8.21:5432/ellyra_synth",
  email: "synthetic.operator@example.test",
  telemetryPayload: '{"node":"ingest-7","ip":"10.0.3.88","trace":"synth-0x9f2c"}',
} as const;

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 fmix32 finalizer: FNV alone barely changes when only the last char differs.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hex32(n: number) {
  return n.toString(16).padStart(8, "0");
}

/** Deterministic UUID-shaped hash (not RFC 4122 random — derived from seed + index). */
export function syntheticUserIdHash(seed: number, index: number): string {
  const parts = [0, 1, 2, 3].map((k) => hex32(fnv1a(`${seed}:${index}:${k}`)));
  const s = parts.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1]![0];
}

function intBetween(rng: Rng, min: number, max: number) {
  return min + Math.floor(rng() * (max - min + 1));
}

function chance(rng: Rng, p: number) {
  return rng() < Math.max(0, Math.min(1, p));
}

// ---------------------------------------------------------------------------
// Persona factory
// ---------------------------------------------------------------------------

const BASE_DATE_MS = Date.UTC(2026, 8, 1);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const DEAD_CLICK_TARGETS = [
  ["card.kpi-nps", 5],
  ["legend.quadrant-toggle", 4],
  ["icon.metric-info", 2],
  ["table.row-expand", 1],
] as const;

const RAGE_CLICK_TARGETS = [
  ["button.export-csv", 5],
  ["chip.feature-filter", 3],
  ["select.date-range", 2],
] as const;

function generateUser(seed: number, index: number): SyntheticHotjarUser {
  const rng = mulberry32(fnv1a(`${seed}:${index}:persona`));

  const account_tier = pickWeighted<AccountTier>(rng, [
    ["free", 40],
    ["starter", 30],
    ["pro", 20],
    ["enterprise", 10],
  ]);
  const user_role = pickWeighted<UserRole>(rng, [
    ["viewer", 50],
    ["operator", 35],
    ["admin", 15],
  ]);
  const device = pickWeighted<DeviceType>(rng, [
    ["desktop", 62],
    ["mobile", 28],
    ["tablet", 10],
  ]);

  // Right-skewed: most sessions are short, with a long tail up to 15 minutes.
  const sessionDurationSec = Math.min(900, 30 + Math.floor(rng() ** 1.6 * 871));

  const touch = device !== "desktop";
  const frustrationSignals: FrustrationSignals = {
    rageClicks: chance(rng, 0.14 + (touch ? 0.12 : 0)) ? intBetween(rng, 1, 4) : 0,
    deadClicks: chance(rng, 0.3 + (device === "mobile" ? 0.15 : 0)) ? intBetween(rng, 1, 6) : 0,
    uTurns: chance(rng, 0.15) ? intBetween(rng, 1, 2) : 0,
    jsErrors: chance(rng, 0.07 + (account_tier === "free" ? 0.04 : 0)) ? intBetween(rng, 1, 3) : 0,
  };

  // Funnel progression, correlated with persona and frustration.
  const tierBoost = account_tier === "enterprise" ? 0.1 : account_tier === "pro" ? 0.06 : 0;
  const reachedDashboard = chance(rng, 0.9 - (frustrationSignals.uTurns > 0 ? 0.08 : 0));
  const reachedFilter =
    reachedDashboard && chance(rng, 0.66 + tierBoost - (user_role === "viewer" ? 0.14 : 0));
  const initiatedExport =
    reachedFilter &&
    chance(
      rng,
      0.58 + tierBoost + (user_role === "viewer" ? -0.2 : 0.06) - (device === "mobile" ? 0.18 : 0),
    );
  const exportFailed =
    initiatedExport &&
    chance(
      rng,
      0.1 +
        (device === "mobile" ? 0.08 : 0) +
        (frustrationSignals.jsErrors > 0 ? 0.35 : 0) +
        (frustrationSignals.rageClicks > 0 ? 0.08 : 0),
    );

  const names: LifecycleEventName[] = ["session_authenticated"];
  if (reachedDashboard) names.push("dashboard_viewed");
  if (reachedFilter) names.push("filter_applied");
  if (initiatedExport)
    names.push("export_initiated", exportFailed ? "export_failed" : "export_completed");

  const offsets = names
    .slice(1)
    // Leaves headroom so the monotonic bump below can never push an event past session end.
    .map(() => 2 + Math.floor(rng() * (sessionDurationSec - 8)))
    .sort((a, b) => a - b);
  const events: SyntheticLifecycleEvent[] = names.map((name, i) => ({
    name,
    atSec: i === 0 ? 0 : Math.max(offsets[i - 1]!, i),
  }));
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.atSec <= events[i - 1]!.atSec) events[i]!.atSec = events[i - 1]!.atSec + 1;
  }

  const at = () => intBetween(rng, 1, sessionDurationSec - 1);
  const interactions: SyntheticInteraction[] = [];
  const normalClicks = intBetween(rng, 2, 4) + Math.floor(sessionDurationSec / 60);
  for (let i = 0; i < normalClicks; i++) {
    interactions.push({
      kind: "click",
      target: UI_TARGETS[intBetween(rng, 0, UI_TARGETS.length - 1)]!,
      atSec: at(),
    });
  }
  for (let i = 0; i < frustrationSignals.deadClicks; i++) {
    interactions.push({
      kind: "dead_click",
      target: pickWeighted(rng, DEAD_CLICK_TARGETS),
      atSec: at(),
    });
  }
  for (let i = 0; i < frustrationSignals.rageClicks; i++) {
    interactions.push({
      kind: "rage_click",
      target: pickWeighted(rng, RAGE_CLICK_TARGETS),
      atSec: at(),
    });
  }
  for (let i = 0; i < frustrationSignals.uTurns; i++) {
    interactions.push({ kind: "u_turn", target: "route:/", atSec: at() });
  }
  for (let i = 0; i < frustrationSignals.jsErrors; i++) {
    interactions.push({
      kind: "js_error",
      target:
        exportFailed && i === 0
          ? "TypeError: export worker crashed"
          : "ChunkLoadError: tooltip bundle",
      atSec: at(),
    });
  }
  interactions.sort((a, b) => a.atSec - b.atSec);

  const userIdHash = syntheticUserIdHash(seed, index);
  const ipHash = fnv1a(`${userIdHash}:ip`);
  return {
    userIdHash,
    account_tier,
    user_role,
    device,
    sessionDurationSec,
    startedAt: new Date(BASE_DATE_MS + Math.floor(rng() * THIRTY_DAYS_MS)).toISOString(),
    frustrationSignals,
    events,
    interactions,
    maskedContext: {
      clientIp: `10.0.${(ipHash >>> 8) & 0xff}.${ipHash & 0xff}`,
      apiKey: `sk_live_synth_${hex32(fnv1a(`${userIdHash}:key`))}${hex32(ipHash)}`,
      email: `synth.user.${userIdHash.slice(0, 6)}@example.test`,
    },
  };
}

export function generateSyntheticHotjarUsers(
  count = 50,
  { seed = DEFAULT_SYNTHETIC_SEED }: GenerateOptions = {},
): SyntheticHotjarUser[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => generateUser(seed, i));
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function hasEvent(user: SyntheticHotjarUser, name: LifecycleEventName) {
  return user.events.some((e) => e.name === name);
}

/** Any frustration signal at all — used by the cohort filter. */
export function hasFrustrationSignals(user: SyntheticHotjarUser) {
  const s = user.frustrationSignals;
  return s.rageClicks + s.deadClicks + s.uTurns + s.jsErrors > 0;
}

/** Narrower definition used by the Frustration Index KPI: rage clicks or UI errors. */
export function isFrustratedSession(user: SyntheticHotjarUser) {
  return user.frustrationSignals.rageClicks > 0 || user.frustrationSignals.jsErrors > 0;
}

export type TimelineEntry =
  | { type: "lifecycle"; atSec: number; name: LifecycleEventName }
  | { type: "interaction"; atSec: number; kind: InteractionKind; target: string };

export function buildSessionTimeline(user: SyntheticHotjarUser): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...user.events.map((e) => ({ type: "lifecycle" as const, atSec: e.atSec, name: e.name })),
    ...user.interactions.map((i) => ({ type: "interaction" as const, ...i })),
  ];
  // Stable sort keeps lifecycle events ahead of interactions that share a timestamp.
  return entries.sort((a, b) => a.atSec - b.atSec);
}

/** Non-PII identify payload for a synthetic persona (what the QA harness sends to Hotjar). */
export function toHotjarAttributes(user: SyntheticHotjarUser) {
  return {
    account_tier: user.account_tier,
    user_role: user.user_role,
    device: user.device,
    synthetic: true,
  };
}
