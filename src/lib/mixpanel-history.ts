import { createHash } from "node:crypto";
import { ASPECTS, FEATURES } from "@/lib/nps-data";

export type MixpanelImportEvent = {
  event: string;
  properties: {
    time: number;
    distinct_id: string;
    $insert_id: string;
    ip: "0";
    [key: string]: string | number | boolean;
  };
};

const TABS = ["scorecard", "rootcause", "verbatims", "simulator"] as const;
const SURVEY_TYPES = ["relational", "transactional"] as const;
const ROUTES = ["P0 Clinical Page", "CS Ticket", "Review Prompt", "Micro-poll"] as const;
const SLA = ["Open", "Contacted", "Resolved", "Escalated"] as const;

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

function insertId(parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function tierForScore(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export function buildHistoricalEvents(
  options: {
    days?: number;
    now?: number;
    seed?: number;
  } = {},
): MixpanelImportEvent[] {
  const days = options.days ?? 180;
  const now = options.now ?? Date.now();
  const rand = mulberry32(options.seed ?? 20261008);
  const end = now - 60_000;
  const start = end - days * 24 * 60 * 60 * 1000;
  const events: MixpanelImportEvent[] = [];
  let sequence = 0;

  const push = (
    event: string,
    when: number,
    distinctId: string,
    properties: Record<string, string | number | boolean>,
  ) => {
    events.push({
      event,
      properties: {
        ...properties,
        time: when,
        distinct_id: distinctId,
        $insert_id: insertId([event, when, distinctId, sequence++]),
        ip: "0",
      },
    });
  };

  for (let day = 0; day < days; day += 1) {
    const dayStart = start + day * 24 * 60 * 60 * 1000;
    const responses = 8 + Math.floor(rand() * 6);
    for (let i = 0; i < responses; i += 1) {
      const user = 1 + Math.floor(rand() * 420);
      const distinctId = `synth-user-${user}`;
      const when = Math.min(end, dayStart + Math.floor(rand() * 20 * 60 * 60 * 1000));
      const score = Math.floor(rand() * 11);
      const feature = pick(rand, FEATURES);
      const aspect = pick(rand, ASPECTS);
      const surveyType = pick(rand, SURVEY_TYPES);
      push("nps_response_recorded", when, distinctId, {
        feature,
        aspect,
        survey_type: surveyType,
        nps_score: score,
        tier: tierForScore(score),
        source: "synthetic_backfill",
      });

      if (score <= 6 && rand() < 0.35) {
        push("safety_flag_routed", when + 1000, distinctId, {
          feature,
          aspect,
          route: pick(rand, ROUTES),
          nps_score: score,
          source: "synthetic_backfill",
        });
      }
    }

    const sessions = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < sessions; i += 1) {
      const user = 500 + Math.floor(rand() * 40);
      const distinctId = `synth-analyst-${user}`;
      const when = Math.min(end, dayStart + Math.floor(rand() * 20 * 60 * 60 * 1000));
      const tab = pick(rand, TABS);
      push("dashboard_tab_viewed", when, distinctId, {
        tab,
        source: "synthetic_backfill",
      });
      if (rand() < 0.7) {
        push("filter_applied", when + 2000, distinctId, {
          feature: pick(rand, FEATURES),
          aspect: pick(rand, ASPECTS),
          tab,
          source: "synthetic_backfill",
        });
      }
      if (tab === "verbatims" && rand() < 0.5) {
        push("verbatim_reviewed", when + 4000, distinctId, {
          feature: pick(rand, FEATURES),
          sla_status: pick(rand, SLA),
          source: "synthetic_backfill",
        });
      }
      if (tab === "simulator" && rand() < 0.4) {
        push("simulator_pipeline_run", when + 3000, distinctId, {
          source: "synthetic_backfill",
        });
      }
    }
  }

  return events.sort((a, b) => a.properties.time - b.properties.time);
}

export function chunkEvents<T>(events: readonly T[], size = 1500): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < events.length; i += size) batches.push(events.slice(i, i + size));
  return batches;
}
