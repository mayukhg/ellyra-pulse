export type MixpanelPropertyValue = string | number | boolean;
export type MixpanelProperties = Record<string, MixpanelPropertyValue>;

// Match PHI-bearing keys, but keep categorical analytics keys like `patient_segment`.
const PII_KEY_PATTERN =
  /e-?mail|full.?name|first.?name|last.?name|(^patient$|patient_id|patient_name|patient_ref)|phone|address|dob|birth|ssn|nhs|mrn|verbatim|comment|free.?text|note|message|token|secret|password|ip_?addr|authorization/i;

/**
 * Drops nested values, long free text, and keys that would carry PHI or credentials.
 * Safe to import from client or server.
 */
export function sanitizeMixpanelProperties(
  properties: Record<string, unknown> = {},
): MixpanelProperties {
  const out: MixpanelProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 120) continue;
      out[key] = trimmed;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}
