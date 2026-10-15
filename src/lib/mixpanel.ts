import mixpanel from "mixpanel-browser";
import type {
  MixpanelEventMap,
  MixpanelEventName,
  MixpanelUserProperties,
} from "@/lib/mixpanel-events";
import {
  sanitizeMixpanelProperties,
  type MixpanelProperties,
  type MixpanelPropertyValue,
} from "@/lib/mixpanel-sanitize";

export type { MixpanelProperties, MixpanelPropertyValue };
export { sanitizeMixpanelProperties };
export type {
  MixpanelEventMap,
  MixpanelEventName,
  MixpanelUserProperties,
} from "@/lib/mixpanel-events";

/** Mixpanel reserved people keys that are set intentionally (not free-text PHI payloads). */
const PEOPLE_ALLOWLIST = new Set([
  "$name",
  "$email",
  "organization_id",
  "role",
  "plan",
  "companions_managed",
  "created_at",
]);

let initialized = false;

export function mixpanelUsesEuResidency(): boolean {
  return (
    import.meta.env.NEXT_PUBLIC_MIXPANEL_EU_RESIDENCY === "true" ||
    import.meta.env.VITE_MIXPANEL_EU_RESIDENCY === "true"
  );
}

export function mixpanelApiHost(): string {
  return mixpanelUsesEuResidency() ? "https://api-eu.mixpanel.com" : "https://api.mixpanel.com";
}

export function getMixpanelToken(): string | null {
  const token = (
    import.meta.env.NEXT_PUBLIC_MIXPANEL_TOKEN ||
    import.meta.env.VITE_MIXPANEL_TOKEN ||
    ""
  ).trim();
  return token.length > 0 ? token : null;
}

function sanitizePeopleProperties(properties: MixpanelUserProperties): MixpanelProperties {
  const out: MixpanelProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!PEOPLE_ALLOWLIST.has(key)) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 200) continue;
      out[key] = trimmed;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function initMixpanel(): boolean {
  if (typeof window === "undefined") return false;
  if (initialized) return true;
  const token = getMixpanelToken();
  if (!token) return false;
  mixpanel.init(token, {
    api_host: mixpanelApiHost(),
    autocapture: false,
    track_pageview: false,
    persistence: "localStorage",
    ignore_dnt: false,
    ip: false,
    debug: import.meta.env.DEV,
    // Session replay can capture on-screen feedback. Leave it off.
    record_sessions_percent: 0,
  });
  initialized = true;
  return true;
}

export function isMixpanelActive(): boolean {
  return typeof window !== "undefined" && initialized;
}

/**
 * Typed track wrapper. Prefer this for catalogue events so property shapes stay consistent.
 */
export function track<E extends MixpanelEventName>(
  event: E,
  properties: MixpanelEventMap[E],
): boolean {
  if (typeof window === "undefined") return false;
  if (!isMixpanelActive()) return false;
  const safe = sanitizeMixpanelProperties(properties as Record<string, unknown>);
  mixpanel.track(event, safe);
  return true;
}

/** Untyped track for transitional / ad-hoc events (page_viewed, simulator, errors). */
export function trackMixpanelEvent(
  eventName: string,
  properties: Record<string, unknown> = {},
): boolean {
  if (typeof window === "undefined") return false;
  if (!isMixpanelActive()) return false;
  const safe = sanitizeMixpanelProperties(properties);
  mixpanel.track(eventName, safe);
  return true;
}

/**
 * Identify a workforce user by internal UUID (never email as distinct_id).
 * Sets people profile properties used for Mixpanel cohorting.
 */
export function identify(userId: string, userProperties: MixpanelUserProperties = {}): boolean {
  if (typeof window === "undefined") return false;
  if (!isMixpanelActive()) return false;
  const id = userId.trim();
  if (!id) return false;
  mixpanel.identify(id);
  const safe = sanitizePeopleProperties(userProperties);
  if (Object.keys(safe).length > 0) {
    mixpanel.people.set(safe);
  }
  return true;
}

/** Clear identity on logout. */
export function reset(): boolean {
  if (typeof window === "undefined") return false;
  if (!isMixpanelActive()) return false;
  mixpanel.reset();
  return true;
}

/** @deprecated Prefer `identify` — kept for Hotjar dual-track naming parity. */
export const identifyMixpanelUser = identify;
/** @deprecated Prefer `reset`. */
export const resetMixpanelUser = reset;
