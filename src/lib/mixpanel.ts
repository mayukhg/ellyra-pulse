import mixpanel from "mixpanel-browser";

export type MixpanelPropertyValue = string | number | boolean;
export type MixpanelProperties = Record<string, MixpanelPropertyValue>;

const PII_KEY_PATTERN =
  /e-?mail|full.?name|first.?name|last.?name|patient|phone|address|dob|birth|ssn|nhs|mrn|verbatim|comment|free.?text|note|message|token|secret|password|ip_?addr|authorization/i;

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

/**
 * Drops nested values, long free text, and keys that would carry PHI or credentials.
 * Mixpanel properties are visible to anyone with project access.
 */
export function sanitizeMixpanelProperties(
  properties: Record<string, unknown> = {},
): MixpanelProperties {
  const out: MixpanelProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 120) continue;
      out[key] = trimmed;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
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

export function trackMixpanelEvent(
  eventName: string,
  properties: Record<string, unknown> = {},
): boolean {
  if (!isMixpanelActive()) return false;
  const safe = sanitizeMixpanelProperties(properties);
  mixpanel.track(eventName, safe);
  return true;
}
