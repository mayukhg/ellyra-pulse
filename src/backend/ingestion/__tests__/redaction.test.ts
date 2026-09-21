import { describe, expect, it } from "vitest";
import { redact, verifyNoLeakage } from "../redaction";

describe("redact", () => {
  it("redacts email addresses", () => {
    const { redactedText, redactionTags } = redact("Reach me at jordan.ellis@example.com please.");
    expect(redactedText).toContain("[REDACTED_EMAIL]");
    expect(redactedText).not.toContain("jordan.ellis@example.com");
    expect(redactionTags).toContain("EMAIL");
  });

  it("redacts a DOB-shaped date", () => {
    const { redactedText, redactionTags } = redact("My DOB is 14/03/1985.");
    expect(redactedText).toContain("[REDACTED_DOB]");
    expect(redactionTags).toContain("DOB");
  });

  it("redacts a checksum-valid NHS number but not an arbitrary 10-digit string", () => {
    // 943 476 0070 passes the mod-11 checksum in redaction.ts's isValidNhsNumber.
    const valid = redact("My NHS number is 943 476 0070.");
    expect(valid.redactedText).toContain("[REDACTED_NHS_NUMBER]");

    // 123 456 7890 fails the mod-11 checksum (remainder 10 is explicitly invalid per spec).
    const invalid = redact("Order number 123 456 7890 was placed today.");
    expect(invalid.redactedText).not.toContain("[REDACTED_NHS_NUMBER]");
  });

  it("redacts a self-introduced name via the heuristic cue pattern", () => {
    const { redactedText, redactionTags } = redact(
      "Hi, this is Jordan Ellis. The report was clear.",
    );
    expect(redactedText).toContain("[REDACTED_NAME]");
    expect(redactedText).not.toContain("Jordan Ellis");
    expect(redactionTags).toContain("NAME");
  });

  it("does not redact a name with no self-introduction cue (documented heuristic limitation)", () => {
    const { redactedText } = redact("Jordan Ellis reviewed my chart today.");
    // Known gap: the heuristic only catches self-introduction phrasing, not arbitrary name
    // mentions. This test documents that limitation rather than asserting it's fixed.
    expect(redactedText).toContain("Jordan Ellis");
  });

  it("leaves clean text untouched", () => {
    const { redactedText, redactionCount } = redact("The explanation was clear and reassuring.");
    expect(redactedText).toBe("The explanation was clear and reassuring.");
    expect(redactionCount).toBe(0);
  });

  it("the heuristic name regex has no shared-state bug across repeated calls", () => {
    // Regression test: NAME_CUE_PATTERN is a module-level global regex. verifyNoLeakage() calls
    // .test() on it, which mutates lastIndex — if that state leaked between calls, an odd
    // number of calls would alternate between correct and incorrect results.
    const text = "Hi, this is Jordan Ellis.";
    const { redactedText } = redact(text);
    expect(verifyNoLeakage(redactedText)).toBe(true);
    expect(verifyNoLeakage(redactedText)).toBe(true);
    expect(verifyNoLeakage(redactedText)).toBe(true);
  });
});

describe("verifyNoLeakage", () => {
  it("flags a leaked NHS number", () => {
    expect(verifyNoLeakage("My NHS number is 943 476 0070.")).toBe(false);
  });

  it("passes fully redacted text", () => {
    const { redactedText } = redact("My NHS number is 943 476 0070 and my DOB is 14/03/1985.");
    expect(verifyNoLeakage(redactedText)).toBe(true);
  });
});
