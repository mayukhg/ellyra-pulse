import { describe, expect, it } from "vitest";
import {
  HOTJAR_FUNNEL_STEPS,
  SYNTHETIC_MASKING_PAYLOADS,
  buildSessionTimeline,
  generateSyntheticHotjarUsers,
  hasEvent,
  toHotjarAttributes,
} from "./fixtures/hotjarSyntheticData";
import {
  applyCohortFilters,
  computeClickDistribution,
  computeFunnel,
  computeKpis,
  usersDroppedAt,
  DEFAULT_COHORT_FILTERS,
} from "@/components/analytics/hotjarMetrics";
import { identifyUser, sanitizeHotjarAttributes, trackHotjarEvent } from "@/lib/hotjar";

const LIFECYCLE_ORDER = [
  "session_authenticated",
  "dashboard_viewed",
  "filter_applied",
  "export_initiated",
] as const;

describe("generateSyntheticHotjarUsers", () => {
  const users = generateSyntheticHotjarUsers(500);

  it("defaults to 50 users and is deterministic regardless of count", () => {
    const fifty = generateSyntheticHotjarUsers();
    expect(fifty).toHaveLength(50);
    expect(fifty).toEqual(users.slice(0, 50));
    expect(generateSyntheticHotjarUsers(5, { seed: 7 })).not.toEqual(users.slice(0, 5));
  });

  it("produces unique UUID-shaped hashes", () => {
    const hashes = new Set(users.map((u) => u.userIdHash));
    expect(hashes.size).toBe(users.length);
    for (const h of hashes)
      expect(h).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("keeps durations within 30..900 and events ordered within the session", () => {
    for (const u of users) {
      expect(Number.isInteger(u.sessionDurationSec)).toBe(true);
      expect(u.sessionDurationSec).toBeGreaterThanOrEqual(30);
      expect(u.sessionDurationSec).toBeLessThanOrEqual(900);

      const names = u.events.map((e) => e.name);
      expect(names[0]).toBe("session_authenticated");
      const prefix = names.filter((n) => n !== "export_completed" && n !== "export_failed");
      expect(prefix).toEqual(LIFECYCLE_ORDER.slice(0, prefix.length));
      const terminal = names.filter((n) => n === "export_completed" || n === "export_failed");
      expect(terminal.length).toBe(names.includes("export_initiated") ? 1 : 0);

      for (let i = 1; i < u.events.length; i++) {
        expect(u.events[i]!.atSec).toBeGreaterThan(u.events[i - 1]!.atSec);
      }
      expect(u.events.at(-1)!.atSec).toBeLessThan(u.sessionDurationSec);
    }
  });

  it("keeps interaction counts consistent with frustrationSignals", () => {
    for (const u of users) {
      const count = (k: string) => u.interactions.filter((i) => i.kind === k).length;
      expect(count("rage_click")).toBe(u.frustrationSignals.rageClicks);
      expect(count("dead_click")).toBe(u.frustrationSignals.deadClicks);
      expect(count("u_turn")).toBe(u.frustrationSignals.uTurns);
      expect(count("js_error")).toBe(u.frustrationSignals.jsErrors);
    }
  });

  it("emits only synthetic masking payloads", () => {
    expect(SYNTHETIC_MASKING_PAYLOADS.apiKey).toMatch(/^sk_live_synth_/);
    for (const u of users) {
      expect(u.maskedContext.apiKey).toMatch(/^sk_live_synth_[0-9a-f]{16}$/);
      expect(u.maskedContext.clientIp).toMatch(/^10\.0\.\d{1,3}\.\d{1,3}$/);
      expect(u.maskedContext.email).toMatch(/@example\.test$/);
    }
  });

  it("merges a chronological timeline", () => {
    const t = buildSessionTimeline(users[0]!);
    expect(t.length).toBe(users[0]!.events.length + users[0]!.interactions.length);
    for (let i = 1; i < t.length; i++) expect(t[i]!.atSec).toBeGreaterThanOrEqual(t[i - 1]!.atSec);
  });
});

describe("hotjar metrics", () => {
  const users = generateSyntheticHotjarUsers(400);

  it("computes a monotonically narrowing funnel whose drop-offs add up", () => {
    const funnel = computeFunnel(users);
    expect(funnel.map((s) => s.key)).toEqual(HOTJAR_FUNNEL_STEPS.map((s) => s.key));
    expect(funnel[0]!.reached).toBe(users.length);
    for (let i = 1; i < funnel.length; i++) {
      expect(funnel[i]!.reached).toBeLessThanOrEqual(funnel[i - 1]!.reached);
      expect(usersDroppedAt(users, funnel[i]!.key)).toHaveLength(funnel[i]!.dropOff);
    }
    expect(usersDroppedAt(users, "session_start")).toEqual([]);
  });

  it("computes KPIs consistent with the funnel", () => {
    const kpis = computeKpis(users);
    const exported = users.filter((u) => hasEvent(u, "export_completed")).length;
    expect(kpis.sessions).toBe(users.length);
    expect(kpis.conversionPct).toBeCloseTo((exported / users.length) * 100);
    expect(kpis.frustrationIndexPct).toBeGreaterThan(0);
    expect(kpis.frustrationIndexPct).toBeLessThan(100);
    expect(computeKpis([])).toEqual({
      sessions: 0,
      avgDurationSec: 0,
      conversionPct: 0,
      frustrationIndexPct: 0,
    });
  });

  it("filters cohorts", () => {
    expect(applyCohortFilters(users, DEFAULT_COHORT_FILTERS)).toHaveLength(users.length);
    const mobilePro = applyCohortFilters(users, {
      ...DEFAULT_COHORT_FILTERS,
      device: "mobile",
      tier: "pro",
    });
    expect(mobilePro.length).toBeGreaterThan(0);
    expect(mobilePro.every((u) => u.device === "mobile" && u.account_tier === "pro")).toBe(true);
    const calm = applyCohortFilters(users, { ...DEFAULT_COHORT_FILTERS, frustration: "no" });
    expect(calm.every((u) => Object.values(u.frustrationSignals).every((n) => n === 0))).toBe(true);
  });

  it("flags dead-click hotspots in the click distribution", () => {
    const rows = computeClickDistribution(users);
    const kpiCard = rows.find((r) => r.target === "card.kpi-nps");
    expect(kpiCard?.deadRatePct).toBeGreaterThan(15);
    expect(rows.every((r, i) => i === 0 || r.total <= rows[i - 1]!.total)).toBe(true);
  });
});

describe("hotjar client wrapper", () => {
  it("keeps only flat primitive, non-PII attributes", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    expect(
      sanitizeHotjarAttributes({
        account_tier: "pro",
        seats: 12,
        beta: true,
        signed_up: date,
        email: "a@b.com",
        full_name: "Jane",
        nested: { a: 1 },
        list: [1],
        missing: undefined,
        nan: Number.NaN,
      }),
    ).toEqual({ account_tier: "pro", seats: 12, beta: true, signed_up: date });
  });

  it("persona attributes are already safe", () => {
    const attrs = toHotjarAttributes(generateSyntheticHotjarUsers(1)[0]!);
    expect(sanitizeHotjarAttributes(attrs)).toEqual(attrs);
  });

  it("is a no-op outside the browser", () => {
    expect(typeof window).toBe("undefined");
    expect(trackHotjarEvent("filter_applied")).toBe(false);
    expect(identifyUser("abc", { account_tier: "pro" })).toBe(false);
  });
});
