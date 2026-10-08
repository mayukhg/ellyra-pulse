#!/usr/bin/env bun
/**
 * Checks the in-memory corpus against the quota contract. Exits non-zero on a miss.
 *
 *   bun scripts/verify-synthetic-quotas.ts
 */
import { buildCorpus } from "../src/backend/synthetic/buildCorpus.ts";
import { verifyCorpus } from "../src/backend/synthetic/verify.ts";

const result = verifyCorpus(buildCorpus());
if (!result.ok) {
  for (const error of result.errors) console.error(error);
  process.exit(1);
}
console.log("Synthetic quotas hold.");
