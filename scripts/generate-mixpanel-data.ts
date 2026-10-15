/**
 * Generate and import 90 days of realistic Ellyra Pulse Mixpanel events.
 *
 * Auth: MIXPANEL_SERVICE_ACCOUNT_USERNAME + MIXPANEL_SERVICE_ACCOUNT_SECRET + MIXPANEL_PROJECT_ID
 * Usage: tsx scripts/generate-mixpanel-data.ts [--dry-run] [--days 90]
 */
import { existsSync, readFileSync } from "node:fs";
import {
  buildSyntheticMixpanelData,
  chunkEvents,
  firstEventsPerType,
  type MixpanelPeopleUpdate,
} from "../src/lib/mixpanel-synthetic";
import type { MixpanelImportEvent } from "../src/lib/mixpanel-history";

type Region = "us" | "eu";

const BATCH_SIZE = 2000;

function loadEnvFile(path: string, override: boolean) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
}

function hosts(region: Region) {
  if (region === "eu") {
    return { api: "https://api-eu.mixpanel.com", app: "https://eu.mixpanel.com" };
  }
  return { api: "https://api.mixpanel.com", app: "https://mixpanel.com" };
}

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function importBatch(
  region: Region,
  authorization: string,
  projectId: string,
  batch: MixpanelImportEvent[],
): Promise<{ imported: number; failed: number }> {
  const url = new URL("/import", hosts(region).api);
  url.searchParams.set("strict", "1");
  url.searchParams.set("project_id", projectId);

  let attempt = 0;
  while (attempt < 5) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(batch),
    });
    const text = await response.text();
    let parsed: { num_records_imported?: number; error?: string; status?: string } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      parsed = {};
    }

    if (response.status === 429 || response.status === 502 || response.status === 503) {
      attempt += 1;
      const wait = Math.min(60_000, 2000 * 2 ** attempt);
      console.log(`Mixpanel returned ${response.status}; retrying in ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    const imported = parsed.num_records_imported ?? (response.ok ? batch.length : 0);
    if (!response.ok) {
      console.error(
        `Import batch failed (${response.status} ${parsed.status ?? ""}): ${parsed.error ?? text.slice(0, 400)}`,
      );
    } else {
      console.log(`Imported ${imported}/${batch.length} events`);
    }
    return { imported, failed: batch.length - imported };
  }
  return { imported: 0, failed: batch.length };
}

async function engagePeople(
  region: Region,
  authorization: string,
  projectId: string,
  token: string | null,
  updates: MixpanelPeopleUpdate[],
): Promise<{ ok: number; failed: number }> {
  if (updates.length === 0) return { ok: 0, failed: 0 };
  // Engage profile-set; include $token when available for project scoping.
  const payload = updates.map((u) => ({
    ...u,
    ...(token ? { $token: token } : {}),
  }));
  const url = new URL("/engage", hosts(region).api);
  url.searchParams.set("verbose", "1");
  if (projectId) url.searchParams.set("project_id", projectId);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`People engage failed (${response.status}): ${text.slice(0, 400)}`);
    return { ok: 0, failed: updates.length };
  }
  console.log(`Upserted ${updates.length} people profiles`);
  return { ok: updates.length, failed: 0 };
}

async function main() {
  loadEnvFile(".env", false);
  loadEnvFile(".env.local", true);

  const dryRun = process.argv.includes("--dry-run");
  const daysFlag = process.argv.indexOf("--days");
  const days = daysFlag >= 0 ? Number(process.argv[daysFlag + 1]) : 90;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 90;

  const bundle = buildSyntheticMixpanelData({ days: safeDays, seed: 20261015 });
  const counts = bundle.events.reduce<Record<string, number>>((acc, e) => {
    acc[e.event] = (acc[e.event] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `Built ${bundle.events.length} events + ${bundle.peopleUpdates.length} people profiles across ${safeDays} days`,
  );
  console.log(`Users: ${bundle.users.length} (churned org users: ${bundle.users.filter((u) => u.churned).length})`);
  console.log(`Companions: ${bundle.companions.length}`);
  console.log("Event counts:");
  for (const [name, count] of Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${name}: ${count}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: first 5 events per type\n");
    const samples = firstEventsPerType(bundle.events, 5);
    for (const [name, rows] of Object.entries(samples).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`\n=== ${name} (${rows.length}) ===`);
      for (const row of rows) console.log(JSON.stringify(row));
    }
    console.log("\n=== people $set (first 5) ===");
    for (const row of bundle.peopleUpdates.slice(0, 5)) console.log(JSON.stringify(row));
    return;
  }

  const username = process.env["MIXPANEL_SERVICE_ACCOUNT_USERNAME"]?.trim() ?? "";
  const secret = process.env["MIXPANEL_SERVICE_ACCOUNT_SECRET"]?.trim() ?? "";
  const projectId = process.env["MIXPANEL_PROJECT_ID"]?.trim() ?? "";
  const token = (
    process.env["NEXT_PUBLIC_MIXPANEL_TOKEN"] ||
    process.env["VITE_MIXPANEL_TOKEN"] ||
    ""
  ).trim();
  const region: Region = process.env["MIXPANEL_EU_RESIDENCY"] === "true" ? "eu" : "us";

  if (!username || !secret || !projectId) {
    console.error(
      "Set MIXPANEL_SERVICE_ACCOUNT_USERNAME, MIXPANEL_SERVICE_ACCOUNT_SECRET, and MIXPANEL_PROJECT_ID in .env or .env.local",
    );
    process.exit(1);
  }

  const authorization = basic(username, secret);
  console.log(`Importing via service account to ${hosts(region).api} (project ${projectId})`);

  let imported = 0;
  let failed = 0;
  const batches = chunkEvents(bundle.events, BATCH_SIZE);
  for (let i = 0; i < batches.length; i += 1) {
    console.log(`Batch ${i + 1}/${batches.length} (${batches[i]!.length} events)...`);
    const result = await importBatch(region, authorization, projectId, batches[i]!);
    imported += result.imported;
    failed += result.failed;
  }

  const people = await engagePeople(region, authorization, projectId, token || null, bundle.peopleUpdates);
  console.log(
    `Done. events imported=${imported} failed=${failed}; people ok=${people.ok} failed=${people.failed}`,
  );
  if (failed > 0 || people.failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Mixpanel generate-data failed");
  process.exit(1);
});
