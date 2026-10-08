import Hotjar from "@hotjar/browser";

export type HotjarAttributeValue = string | number | boolean | Date;
export type HotjarAttributes = Record<string, HotjarAttributeValue>;

type HotjarFn = ((...args: unknown[]) => void) & { q?: unknown[] };

declare global {
  interface Window {
    hj?: HotjarFn;
  }
}

const DEFAULT_VERSION = 6;

/**
 * Compile-time flag for the dev-only tooling (QA harness, /dev/hotjar-insights). Guard sites
 * that must be tree-shaken out of production builds should inline this same expression rather
 * than import the constant, so the bundler can fold it without cross-module analysis.
 */
export const HOTJAR_DEV_TOOLS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_HOTJAR_DEBUG === "true";

export function getHotjarConfig() {
  const rawId = import.meta.env.VITE_HOTJAR_SITE_ID;
  const siteId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
  const rawVersion = Number.parseInt(import.meta.env.VITE_HOTJAR_VERSION ?? "", 10);
  return {
    siteId: Number.isFinite(siteId) && siteId > 0 ? siteId : null,
    version: Number.isFinite(rawVersion) ? rawVersion : DEFAULT_VERSION,
    debug: import.meta.env.VITE_ENABLE_HOTJAR_DEBUG === "true",
  };
}

const isBrowser = () => typeof window !== "undefined";

let initialized = false;

// ---------------------------------------------------------------------------
// Local event log — mirrors every command sent through this module so the dev harness and
// insights dashboard can show live feedback even when Hotjar itself is disabled or blocked.
// ---------------------------------------------------------------------------

export type HotjarLogKind = "init" | "event" | "identify" | "reset" | "stateChange";

export type HotjarLogEntry = {
  id: number;
  at: number;
  kind: HotjarLogKind;
  name: string;
  /** False when Hotjar was not initialised, so the command only reached the local log. */
  sent: boolean;
};

const LOG_LIMIT = 200;
let logSeq = 0;
let log: HotjarLogEntry[] = [];
const listeners = new Set<() => void>();

function record(kind: HotjarLogKind, name: string, sent: boolean) {
  log = [{ id: ++logSeq, at: Date.now(), kind, name, sent }, ...log].slice(0, LOG_LIMIT);
  listeners.forEach((l) => l());
}

export function getHotjarLog(): readonly HotjarLogEntry[] {
  return log;
}

export function subscribeHotjarLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearHotjarLog() {
  log = [];
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initHotjar(): boolean {
  if (!isBrowser()) return false;
  if (initialized) return true;
  const { siteId, version, debug } = getHotjarConfig();
  if (siteId === null) return false;
  initialized = Hotjar.init(siteId, version, { debug });
  record("init", `site ${siteId} · v${version}`, initialized);
  return initialized;
}

export function isHotjarActive(): boolean {
  return isBrowser() && initialized && typeof window.hj === "function";
}

// Keys that would carry PII if sent as identify attributes. Hotjar attributes are visible to
// anyone with dashboard access, so these are dropped even if a caller passes them.
const PII_KEY_PATTERN =
  /e-?mail|name|phone|address|dob|birth|ssn|nhs|mrn|ip_?addr|token|secret|password/i;

/**
 * Hotjar's identify API accepts only a flat map of string | number | boolean | Date. Anything
 * else (nested objects, arrays, null/undefined, NaN) is dropped, as are PII-looking keys.
 */
export function sanitizeHotjarAttributes(attributes: Record<string, unknown>): HotjarAttributes {
  const out: HotjarAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (PII_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (value instanceof Date && !Number.isNaN(value.getTime())) out[key] = value;
  }
  return out;
}

export function identifyUser(userIdHash: string, attributes: HotjarAttributes = {}): boolean {
  if (!isBrowser()) return false;
  const safe = sanitizeHotjarAttributes(attributes);
  const sent = isHotjarActive() && Hotjar.identify(userIdHash, safe);
  record("identify", userIdHash, sent);
  return sent;
}

export function trackHotjarEvent(eventName: string): boolean {
  if (!isBrowser()) return false;
  const sent = isHotjarActive() && Hotjar.event(eventName);
  record("event", eventName, sent);
  return sent;
}

/** Call on logout so the next session is not attributed to the previous user. */
export function resetHotjarUser(): boolean {
  if (!isBrowser()) return false;
  let sent = false;
  if (isHotjarActive()) {
    window.hj?.("identify", null, {});
    sent = true;
  }
  record("reset", "identify(null)", sent);
  return sent;
}

/** SPA route changes: lets Hotjar split heatmaps/recordings per virtual page. */
export function trackHotjarStateChange(path: string): boolean {
  if (!isBrowser()) return false;
  const sent = isHotjarActive() && Hotjar.stateChange(path);
  record("stateChange", path, sent);
  return sent;
}

export type HotjarQueueStatus = {
  configured: boolean;
  initialized: boolean;
  /** window.hj exists (stub or real). */
  hjPresent: boolean;
  /** Length of the window.hj.q stub buffer, or null when no buffer is exposed. */
  queueLength: number | null;
};

export function getHotjarQueueStatus(): HotjarQueueStatus {
  const configured = getHotjarConfig().siteId !== null;
  if (!isBrowser() || typeof window.hj !== "function") {
    return { configured, initialized, hjPresent: false, queueLength: null };
  }
  const q = window.hj.q;
  return {
    configured,
    initialized,
    hjPresent: true,
    queueLength: Array.isArray(q) ? q.length : null,
  };
}
