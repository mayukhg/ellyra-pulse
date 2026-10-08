/**
 * Backfill synthetic Ellyra Pulse events into Mixpanel via POST /import.
 *
 * Auth prefers the service account in .env.local. project_id is required for that
 * method; when MIXPANEL_PROJECT_ID is unset the script looks the project up.
 * If service-account auth cannot see a project, it falls back to the project token.
 *
 * Usage: tsx scripts/import-mixpanel-history.ts [--dry-run] [--days 180]
 */
import { existsSync, readFileSync } from "node:fs";
import {
  chunkEvents,
  buildHistoricalEvents,
  type MixpanelImportEvent,
} from "../src/lib/mixpanel-history";

type Region = "us" | "eu";

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

async function listProjectIds(region: Region, authorization: string): Promise<string[]> {
  const response = await fetch(`${hosts(region).app}/api/app/projects`, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results)
      ? (body as { results: unknown[] }).results
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const id =
        (row as { id?: unknown; project_id?: unknown }).id ??
        (row as { project_id?: unknown }).project_id;
      return id === undefined || id === null ? "" : String(id);
    })
    .filter((id) => id.length > 0);
}

async function importBatch(
  region: Region,
  authorization: string,
  projectId: string | null,
  batch: MixpanelImportEvent[],
): Promise<{ imported: number; failed: number }> {
  const url = new URL("/import", hosts(region).api);
  url.searchParams.set("strict", "1");
  if (projectId) url.searchParams.set("project_id", projectId);

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
        `Import batch failed (${response.status} ${parsed.status ?? ""}): ${parsed.error ?? "validation error"}`,
      );
    } else {
      console.log(`Imported ${imported} events`);
    }
    return { imported, failed: batch.length - imported };
  }
  return { imported: 0, failed: batch.length };
}

async function main() {
  loadEnvFile(".env", false);
  loadEnvFile(".env.local", true);

  const dryRun = process.argv.includes("--dry-run");
  const daysFlag = process.argv.indexOf("--days");
  const days = daysFlag >= 0 ? Number(process.argv[daysFlag + 1]) : 180;
  const events = buildHistoricalEvents({ days: Number.isFinite(days) && days > 0 ? days : 180 });
  console.log(`Built ${events.length} synthetic events across ${days} days`);
  if (dryRun) return;

  const username = process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME?.trim() ?? "";
  const secret = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET?.trim() ?? "";
  const token = (
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN ||
    process.env.VITE_MIXPANEL_TOKEN ||
    ""
  ).trim();
  const preferred: Region[] =
    process.env.MIXPANEL_EU_RESIDENCY === "true" ? ["eu", "us"] : ["us", "eu"];

  let region: Region = preferred[0]!;
  let authorization = "";
  let projectId = process.env.MIXPANEL_PROJECT_ID?.trim() || null;
  let mode = "";

  if (username && secret) {
    const serviceAuth = basic(username, secret);
    for (const candidate of preferred) {
      const ids = await listProjectIds(candidate, serviceAuth);
      if (ids.length === 0) continue;
      region = candidate;
      authorization = serviceAuth;
      mode = "service_account";
      if (!projectId) projectId = ids[0] ?? null;
      else if (!ids.includes(projectId)) {
        console.error(`MIXPANEL_PROJECT_ID ${projectId} was not visible to the service account.`);
        process.exit(1);
      }
      break;
    }
  }

  if (username && secret && !authorization) {
    console.log("Service account could not list projects. Falling back to the project token.");
  }

  if (!authorization && token) {
    region = preferred[0]!;
    authorization = basic(token, "");
    projectId = null;
    mode = "project_token";
  }

  if (!authorization) {
    console.error(
      "Set MIXPANEL_SERVICE_ACCOUNT_USERNAME and MIXPANEL_SERVICE_ACCOUNT_SECRET, or NEXT_PUBLIC_MIXPANEL_TOKEN, in .env.local.",
    );
    process.exit(1);
  }

  console.log(
    `Importing via ${mode} to ${hosts(region).api}${projectId ? ` (project ${projectId})` : ""}`,
  );

  let imported = 0;
  let failed = 0;
  for (const batch of chunkEvents(events)) {
    const result = await importBatch(region, authorization, projectId, batch);
    imported += result.imported;
    failed += result.failed;
  }
  console.log(`Done. imported=${imported} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Mixpanel import failed");
  process.exit(1);
});
