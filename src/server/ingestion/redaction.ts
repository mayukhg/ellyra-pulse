/**
 * Deterministic PHI redaction — §9.1/§9.2 layer 1 of the ingestion pipeline.
 * Runs before any NER pass, before any classifier, before persistence.
 *
 * This is a scaffold: pattern-based detection for the structured identifiers (DOB, email,
 * phone, NHS number, MRN) plus a hook point for an approved medical NER pass. Free-text name
 * detection needs contextual NER per §9.1 and is intentionally left as a TODO — do not ship a
 * static name list as a substitute.
 */
import type { RedactionTag } from "../contracts";

export interface RedactionResult {
  redactedText: string;
  redactions: Array<{ tag: RedactionTag; count: number }>;
  redactionTags: RedactionTag[];
  redactionCount: number;
}

export const REDACTION_VERSION = "deterministic-v1";

const REPLACEMENTS: Record<RedactionTag, string> = {
  DOB: "[REDACTED_DOB]",
  NAME: "[REDACTED_NAME]",
  MRN: "[REDACTED_MRN]",
  NHS_NUMBER: "[REDACTED_NHS_NUMBER]",
  EMAIL: "[REDACTED_EMAIL]",
  PHONE: "[REDACTED_PHONE]",
  ADDRESS: "[REDACTED_ADDRESS]",
  MEMBER_ID: "[REDACTED_MEMBER_ID]",
  IDENTIFIER: "[REDACTED_IDENTIFIER]",
};

// NHS number: 10 digits, optionally spaced 3-3-4, checksum-validated (mod 11) — not matched as
// an arbitrary 10-digit string, per §9.1.
function isValidNhsNumber(digits: string): boolean {
  if (digits.length !== 10) return false;
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const checkDigit = Number(digits[9]);
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  let remainder = 11 - (sum % 11);
  if (remainder === 11) remainder = 0;
  if (remainder === 10) return false; // invalid NHS number by spec
  return remainder === checkDigit;
}

const PATTERNS: Array<{ tag: RedactionTag; regex: RegExp; validate?: (raw: string) => boolean }> = [
  { tag: "EMAIL", regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { tag: "PHONE", regex: /\+?\d[\d\s().-]{7,}\d/g },
  {
    tag: "DOB",
    regex: /\b(0?[1-9]|[12]\d|3[01])[/\-.](0?[1-9]|1[0-2])[/\-.](\d{4}|\d{2})\b/g,
  },
  {
    tag: "NHS_NUMBER",
    regex: /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g,
    validate: (raw) => isValidNhsNumber(raw.replace(/[\s-]/g, "")),
  },
  {
    tag: "MRN",
    regex: /\b(?:MRN|mrn|record\s*#?|patient\s*id)[:\s#]*[A-Za-z0-9-]{4,}\b/g,
  },
  {
    tag: "MEMBER_ID",
    regex: /\b(?:member\s*id|account\s*(?:no|number)?)[:\s#]*[A-Za-z0-9-]{4,}\b/gi,
  },
];

export function redact(rawText: string): RedactionResult {
  let text = rawText;
  const counts = new Map<RedactionTag, number>();

  for (const { tag, regex, validate } of PATTERNS) {
    text = text.replace(regex, (match) => {
      if (validate && !validate(match)) return match;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      return REPLACEMENTS[tag];
    });
  }

  // TODO: plug in the approved medical NER pass here for NAME and ADDRESS detection
  // (contextual — do not replace with a static name list). Track its own redaction_version
  // component once wired in, per §9.1/§9.2.

  const redactions = Array.from(counts.entries()).map(([tag, count]) => ({ tag, count }));
  const redactionCount = redactions.reduce((sum, r) => sum + r.count, 0);

  return {
    redactedText: text,
    redactions,
    redactionTags: redactions.map((r) => r.tag),
    redactionCount,
  };
}

/**
 * Leakage verification pass (§9.2 "redaction verification / leakage scan") — a cheap
 * defense-in-depth check that no un-redacted structured identifier pattern survived the
 * primary pass. Returns true if the text looks clean.
 */
export function verifyNoLeakage(redactedText: string): boolean {
  return !PATTERNS.some(({ regex, validate }) => {
    const matches = redactedText.match(regex);
    if (!matches) return false;
    if (!validate) return true;
    return matches.some((m) => validate(m));
  });
}
