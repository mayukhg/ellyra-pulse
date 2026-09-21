/**
 * Aspect-based sentiment tagging (ABSA) — §5.4 taxonomy, runs on REDACTED text only.
 *
 * Scaffold implementation: lexicon-based aspect detection + polarity scoring, multi-label with
 * per-aspect confidence. Replace the lexicons with the approved ABSA model output when
 * available; keep the same output shape so callers don't need to change.
 */
import { ASPECT_TAXONOMY, CLINICAL_ASPECTS, type AspectKey } from "../contracts";

export interface AspectResult {
  aspect: AspectKey;
  polarity: number; // -1..1
  confidence: number; // 0..1
}

export interface AbsaResult {
  sentiment: number; // overall, independent of aspects
  aspects: AspectResult[];
  classifierVersion: string;
}

export const ABSA_CLASSIFIER_VERSION = "lexicon-absa-v1";

const POSITIVE_LEXICON: Record<AspectKey, RegExp> = {
  clinical_trust: /\b(matched|accurate|confirmed|reassur\w*|correct)\b/i,
  tone_and_bedside_manner: /\b(calm\w*|compassion\w*|kind|gentle|empathetic)\b/i,
  document_parsing_ocr: /\b(read (my|the) (pdf|scan|report)|parsed (it|the).{0,15}(well|correctly|seamlessly))\b/i,
  actionability: /\b(bullet points?|clear next steps?|questions? (to|for) (my|the) (doctor|gp|consultant)|actionable)\b/i,
  billing_cost: /\b(worth (it|the money)|fair price|good value)\b/i,
  ui_confusion: /\b(easy to (use|navigate)|intuitive|simple to use)\b/i,
  response_speed: /\b(fast|quick|instant\w*|no wait)\b/i,
};

const NEGATIVE_LEXICON: Record<AspectKey, RegExp> = {
  clinical_trust: /\b(wrong|alarming|hallucinat\w*|inaccurate|conflict\w*)\b/i,
  tone_and_bedside_manner: /\b(cold|robotic|dismissive|detached|harsh)\b/i,
  document_parsing_ocr: /\b(fail\w* to parse|couldn'?t read|blurry|missed (a |the )?page|OCR error)\b/i,
  actionability: /\b(just (told|said) (me )?to (see|consult) a doctor|no explanation|vague)\b/i,
  billing_cost: /\b(expensive|overpriced|hidden fee|billing (issue|error))\b/i,
  ui_confusion: /\b(confus\w*|hard to (find|use)|couldn'?t figure out)\b/i,
  response_speed: /\b(slow|lag\w*|took (forever|too long)|timed out)\b/i,
};

export function classifyAbsa(redactedText: string): AbsaResult {
  const aspects: AspectResult[] = [];

  for (const aspect of ASPECT_TAXONOMY) {
    const positive = POSITIVE_LEXICON[aspect].test(redactedText);
    const negative = NEGATIVE_LEXICON[aspect].test(redactedText);
    if (!positive && !negative) continue;

    let polarity = 0;
    if (positive && !negative) polarity = 1;
    else if (negative && !positive) polarity = -1;

    aspects.push({ aspect, polarity, confidence: 0.7 });
  }

  const overallSentiment = aspects.length
    ? Number((aspects.reduce((sum, a) => sum + a.polarity, 0) / aspects.length).toFixed(3))
    : 0;

  return { sentiment: overallSentiment, aspects, classifierVersion: ABSA_CLASSIFIER_VERSION };
}

export function isClinicalAspect(aspect: AspectKey): boolean {
  return CLINICAL_ASPECTS.has(aspect);
}
