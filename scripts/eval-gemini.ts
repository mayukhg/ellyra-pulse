#!/usr/bin/env bun
/**
 * Validates the Gemini gold set. Calls the model only when GEMINI_EVAL_ENDPOINT is set.
 *
 *   bun scripts/eval-gemini.ts
 *
 * Exit 0: set is valid and, if a model ran, signed held-out cases passed.
 * Exit 1: signed held-out cases failed, or the endpoint was refused.
 * Exit 2: a model ran, but no signed held-out case exists to promote against.
 */
import { GOLD_CASES, validateGoldSet } from "../src/backend/eval/goldCases.ts";
import { promptSha256 } from "../src/backend/eval/prompt.ts";
import { runEval } from "../src/backend/eval/run.ts";
import { createGeminiTransport } from "../src/backend/eval/transport.ts";
import type { EvalReport } from "../src/backend/eval/score.ts";

function printSummary(
  report: Pick<
    EvalReport,
    | "promotion"
    | "blockedReason"
    | "harmMisses"
    | "mismatchMisses"
    | "leakageFailures"
    | "parseFailures"
    | "review"
  > & { modelId: string },
) {
  console.log(`prompt sha256: ${promptSha256()}`);
  console.log(`model: ${report.modelId}`);
  console.log(
    `cases: ${GOLD_CASES.length} (signed held-out ${GOLD_CASES.filter((row) => row.split === "heldout" && row.labelStatus === "signed").length})`,
  );
  console.log(
    `promotion: ${report.promotion}${report.blockedReason ? ` (${report.blockedReason})` : ""}`,
  );
  console.log(
    `signed held-out misses: harm ${report.harmMisses}, mismatch ${report.mismatchMisses}, leakage ${report.leakageFailures}, parse ${report.parseFailures}`,
  );
  if (report.review.length > 0) {
    console.log("review ids:");
    for (const row of report.review) {
      console.log(
        `  ${row.id} missed=${row.missedCodes.join(",") || "-"} extra=${row.extraCodes.join(",") || "-"}`,
      );
    }
  }
}

validateGoldSet(GOLD_CASES);

const endpoint = process.env["GEMINI_EVAL_ENDPOINT"];
if (!endpoint) {
  printSummary({
    modelId: "not called",
    promotion: "blocked",
    blockedReason: "no signed held-out cases",
    harmMisses: 0,
    mismatchMisses: 0,
    leakageFailures: 0,
    parseFailures: 0,
    review: [],
  });
  console.log("No endpoint set. Gold set checked. Model was not called.");
  process.exit(0);
}

const temperature = Number(process.env["GEMINI_EVAL_TEMPERATURE"] ?? "0");
const transport = createGeminiTransport({
  endpoint,
  apiKey: process.env["GEMINI_EVAL_API_KEY"] ?? "",
  modelId: process.env["GEMINI_EVAL_MODEL"] ?? "",
  temperature,
});
const report = await runEval(GOLD_CASES, transport);
printSummary(report);
if (report.promotion === "pass") process.exit(0);
if (report.promotion === "blocked") process.exit(2);
process.exit(1);
