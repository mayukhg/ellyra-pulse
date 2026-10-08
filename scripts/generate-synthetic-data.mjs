#!/usr/bin/env bun
/**
 * Writes the quota corpus to data/synthetic/generated/*.jsonl.
 * The directory is gitignored. Run before scripts/seed-postgres.mjs.
 *
 *   bun scripts/generate-synthetic-data.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCorpus } from "../src/backend/synthetic/buildCorpus.ts";
import { serializedFacts } from "../src/backend/synthetic/serialize.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "data", "synthetic", "generated");
mkdirSync(outDir, { recursive: true });

const facts = serializedFacts(buildCorpus());
for (const [name, rows] of Object.entries(facts)) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path.join(outDir, name), body.length > 0 ? `${body}\n` : "");
  console.log(`${name}: ${rows.length}`);
}
console.log(`Output: ${outDir}`);
