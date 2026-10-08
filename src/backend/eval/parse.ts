import { SAFETY_REASON_CODES, type SafetyReasonCode } from "../contracts";

const KNOWN = new Set<string>(SAFETY_REASON_CODES);

export interface ParsedCodes {
  codes: SafetyReasonCode[];
  unknownCodes: string[];
  parseError: boolean;
}

/** Pulls reason codes from the model's JSON. Does not keep the surrounding text. */
export function parseReasonCodes(modelText: string): ParsedCodes {
  const start = modelText.indexOf("{");
  const end = modelText.lastIndexOf("}");
  if (start < 0 || end <= start) return { codes: [], unknownCodes: [], parseError: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(modelText.slice(start, end + 1));
  } catch {
    return { codes: [], unknownCodes: [], parseError: true };
  }
  if (!parsed || typeof parsed !== "object" || !("reasonCodes" in parsed)) {
    return { codes: [], unknownCodes: [], parseError: true };
  }
  const raw = (parsed as { reasonCodes: unknown }).reasonCodes;
  if (!Array.isArray(raw) || raw.some((code) => typeof code !== "string")) {
    return { codes: [], unknownCodes: [], parseError: true };
  }

  const codes: SafetyReasonCode[] = [];
  const unknownCodes: string[] = [];
  for (const code of raw) {
    if (KNOWN.has(code)) codes.push(code as SafetyReasonCode);
    else unknownCodes.push(code);
  }
  return { codes, unknownCodes, parseError: false };
}
