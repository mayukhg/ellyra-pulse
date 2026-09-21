import { describe, expect, it } from "vitest";
import { classifyAbsa } from "../absa";

describe("classifyAbsa", () => {
  it("detects a positive clinical_trust aspect", () => {
    const result = classifyAbsa(
      "The explanation matched what my GP told me afterwards, which was reassuring.",
    );
    const aspect = result.aspects.find((a) => a.aspect === "clinical_trust");
    expect(aspect).toBeDefined();
    expect(aspect!.polarity).toBe(1);
  });

  it("detects a negative document_parsing_ocr aspect", () => {
    const result = classifyAbsa("It failed to parse page 2 of my MRI report at all.");
    const aspect = result.aspects.find((a) => a.aspect === "document_parsing_ocr");
    expect(aspect).toBeDefined();
    expect(aspect!.polarity).toBe(-1);
  });

  it("can detect mixed polarity across aspects in one comment", () => {
    const result = classifyAbsa(
      "The explanation matched what my GP told me, which was reassuring, but it failed to parse page 2 of my MRI report at all.",
    );
    const trust = result.aspects.find((a) => a.aspect === "clinical_trust");
    const ocr = result.aspects.find((a) => a.aspect === "document_parsing_ocr");
    expect(trust?.polarity).toBe(1);
    expect(ocr?.polarity).toBe(-1);
  });

  it("returns no aspects and neutral sentiment for text matching no lexicon entries", () => {
    const result = classifyAbsa("Nothing in particular to report.");
    expect(result.aspects).toHaveLength(0);
    expect(result.sentiment).toBe(0);
  });
});
