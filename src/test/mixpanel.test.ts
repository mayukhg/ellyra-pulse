import { describe, expect, it } from "vitest";
import { sanitizeMixpanelProperties } from "@/lib/mixpanel";
import { buildHistoricalEvents, chunkEvents } from "@/lib/mixpanel-history";
import {
  buildSyntheticMixpanelData,
  firstEventsPerType,
} from "@/lib/mixpanel-synthetic";
import { MIXPANEL_EVENT_NAMES } from "@/lib/mixpanel-events";

describe("sanitizeMixpanelProperties", () => {
  it("keeps short categorical values and drops PHI-like keys and free text", () => {
    const safe = sanitizeMixpanelProperties({
      feature: "MRI / Imaging Insights",
      nps_score: 4,
      critical: true,
      patient_segment: "chronic_care",
      verbatim: "Patient Jane Doe, NHS 1234567890, called about her scan",
      email: "person@example.com",
      note: "free text that should not leave the dashboard",
      comment: "x".repeat(200),
    });

    expect(safe).toEqual({
      feature: "MRI / Imaging Insights",
      nps_score: 4,
      critical: true,
      patient_segment: "chronic_care",
    });
  });
});

describe("buildHistoricalEvents", () => {
  it("builds deterministic import records with no free-text feedback", () => {
    const now = Date.parse("2026-10-08T00:00:00Z");
    const first = buildHistoricalEvents({ days: 3, now, seed: 7 });
    const second = buildHistoricalEvents({ days: 3, now, seed: 7 });

    expect(first.length).toBeGreaterThan(20);
    expect(first).toEqual(second);
    expect(chunkEvents(first, 10).flat()).toEqual(first);

    const ids = new Set<string>();
    for (const event of first) {
      expect(event.event.length).toBeGreaterThan(0);
      expect(event.properties.time).toBeLessThan(now);
      expect(event.properties.distinct_id.startsWith("synth-")).toBe(true);
      expect(event.properties.$insert_id).toMatch(/^[a-f0-9]{32}$/);
      expect(event.properties.ip).toBe("0");
      expect(event.properties["source"]).toBe("synthetic_backfill");
      expect(JSON.stringify(event)).not.toMatch(/nhs|@/i);
      ids.add(event.properties.$insert_id);
    }
    expect(ids.size).toBe(first.length);
  });
});

describe("buildSyntheticMixpanelData", () => {
  it("builds a deterministic 90-day catalogue with stable insert ids", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const first = buildSyntheticMixpanelData({ days: 90, now, seed: 20261015 });
    const second = buildSyntheticMixpanelData({ days: 90, now, seed: 20261015 });

    expect(first.users).toHaveLength(20);
    expect(first.companions).toHaveLength(12);
    expect(first.events.length).toBeGreaterThan(1000);
    expect(first.events).toEqual(second.events);
    expect(first.peopleUpdates).toHaveLength(20);

    const churned = first.users.filter((u) => u.churned);
    expect(churned.length).toBeGreaterThan(0);
    for (const user of churned) {
      const names = first.events
        .filter((e) => e.properties.distinct_id === user.distinct_id)
        .map((e) => e.event);
      expect(names).toContain("user_signed_up");
      expect(names).not.toContain("dashboard_viewed");
    }

    const tiers = Object.fromEntries(
      (["healthy", "at_risk", "suspended", "new"] as const).map((t) => [
        t,
        first.companions.filter((c) => c.tier === t).length,
      ]),
    );
    expect(tiers).toEqual({ healthy: 3, at_risk: 3, suspended: 2, new: 4 });

    const catalogue = new Set(MIXPANEL_EVENT_NAMES);
    const seen = new Set(first.events.map((e) => e.event).filter((e) => e !== "$identify"));
    for (const name of catalogue) {
      expect(seen.has(name), `missing event ${name}`).toBe(true);
    }

    const ids = new Set<string>();
    const nowSec = Math.floor(now / 1000);
    for (const event of first.events) {
      expect(event.properties.time).toBeLessThan(nowSec);
      expect(event.properties.$insert_id).toMatch(/^[a-f0-9]{32}$/);
      expect(event.properties.ip).toBe("0");
      expect(event.properties.distinct_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      ids.add(event.properties.$insert_id);
    }
    expect(ids.size).toBe(first.events.length);

    const samples = firstEventsPerType(first.events, 5);
    expect(Object.keys(samples).length).toBeGreaterThan(10);
    expect(chunkEvents(first.events, 2000).every((b) => b.length <= 2000)).toBe(true);
  });
});
