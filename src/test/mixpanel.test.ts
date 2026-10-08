import { describe, expect, it } from "vitest";
import { sanitizeMixpanelProperties } from "@/lib/mixpanel";
import { buildHistoricalEvents, chunkEvents } from "@/lib/mixpanel-history";

describe("sanitizeMixpanelProperties", () => {
  it("keeps short categorical values and drops PHI-like keys and free text", () => {
    const safe = sanitizeMixpanelProperties({
      feature: "MRI / Imaging Insights",
      nps_score: 4,
      critical: true,
      verbatim: "Patient Jane Doe, NHS 1234567890, called about her scan",
      email: "person@example.com",
      note: "free text that should not leave the dashboard",
      comment: "x".repeat(200),
    });

    expect(safe).toEqual({
      feature: "MRI / Imaging Insights",
      nps_score: 4,
      critical: true,
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
      expect(JSON.stringify(event)).not.toMatch(/nhs|patient|@/i);
      ids.add(event.properties.$insert_id);
    }
    expect(ids.size).toBe(first.length);
  });
});
