/**
 * Runs the pinned prompt against one transport and scores reason codes locally.
 * Nothing is paged and nothing is written to the feedback store.
 * Model text is dropped after leakage check and code parsing.
 */
import { redact, verifyNoLeakage } from "../ingestion/redaction";
import type { GoldCase } from "./goldCases";
import { parseReasonCodes } from "./parse";
import { promptSha256, renderPrompt } from "./prompt";
import { promotionReport, scoreCase, type CaseScore, type EvalReport } from "./score";
import type { EvalTransport } from "./transport";

async function scoreOne(gold: GoldCase, transport: EvalTransport): Promise<CaseScore> {
  const { redactedText } = redact(gold.source);
  if (!verifyNoLeakage(redactedText)) {
    return scoreCase(gold, [], { inputBlocked: true, outputBlocked: false, parseError: false });
  }

  const modelText = await transport.complete(renderPrompt(redactedText));
  if (!verifyNoLeakage(modelText)) {
    return scoreCase(gold, [], { inputBlocked: false, outputBlocked: true, parseError: false });
  }

  const parsed = parseReasonCodes(modelText);
  return scoreCase(gold, parsed.codes, {
    inputBlocked: false,
    outputBlocked: false,
    parseError: parsed.parseError,
  });
}

export async function runEval(
  cases: readonly GoldCase[],
  transport: EvalTransport,
): Promise<EvalReport> {
  const scored: CaseScore[] = [];
  for (const gold of cases) scored.push(await scoreOne(gold, transport));
  return promotionReport(scored, {
    modelId: transport.modelId,
    temperature: transport.temperature,
    promptSha256: promptSha256(),
  });
}
