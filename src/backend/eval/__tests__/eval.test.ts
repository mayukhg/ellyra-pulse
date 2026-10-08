import { describe, expect, it, vi } from "vitest";
import { HARM_CODES, MISMATCH_CODES } from "../../synthetic/quotas";
import { GOLD_CASES, validateGoldSet, type GoldCase } from "../goldCases";
import { parseReasonCodes } from "../parse";
import { promptSha256 } from "../prompt";
import { runEval } from "../run";
import { promotionReport, scoreCase } from "../score";
import { assertEvalEndpoint, type EvalTransport } from "../transport";

function transport(reply: (prompt: string) => string): EvalTransport {
  return {
    modelId: "fake-gemini",
    temperature: 0,
    complete: (prompt) => Promise.resolve(reply(prompt)),
  };
}

function signed(partial: Pick<GoldCase, "id" | "expectedCodes" | "split">): GoldCase {
  return {
    ...partial,
    feature: "lab_blood_parser",
    labelStatus: "signed",
    source: "Synthetic source with no identifier.",
  };
}

describe("gemini eval", () => {
  it("keeps the committed set as an unsigned draft that cannot promote", async () => {
    validateGoldSet(GOLD_CASES);
    expect(GOLD_CASES.every((row) => row.labelStatus === "draft")).toBe(true);
    for (const code of [...HARM_CODES, ...MISMATCH_CODES]) {
      expect(
        GOLD_CASES.some((row) => row.split === "heldout" && row.expectedCodes.includes(code)),
      ).toBe(true);
    }
    const report = await runEval(
      GOLD_CASES,
      transport(() => JSON.stringify({ reasonCodes: [] })),
    );
    expect(report.promotion).toBe("blocked");
    expect(report.blockedReason).toBe("no signed held-out cases");
    expect(report.cases.every((row) => !row.inputBlocked)).toBe(true);
    expect(report.promptSha256).toBe(promptSha256());
    expect(JSON.stringify(report)).not.toContain("Hemoglobin");
  });

  it("fails promotion when a signed held-out harm code is missed", () => {
    const missed = scoreCase(
      signed({ id: "harm", split: "heldout", expectedCodes: ["medication_danger"] }),
      [],
      {
        inputBlocked: false,
        outputBlocked: false,
        parseError: false,
      },
    );
    const report = promotionReport([missed], {
      modelId: "fake-gemini",
      temperature: 0,
      promptSha256: "abc",
    });
    expect(report.promotion).toBe("fail");
    expect(report.harmMisses).toBe(1);
  });

  it("ignores an author miss and passes when signed held-out codes match", () => {
    const heldout = scoreCase(
      signed({ id: "held", split: "heldout", expectedCodes: ["ocr_unit_mismatch"] }),
      ["ocr_unit_mismatch"],
      { inputBlocked: false, outputBlocked: false, parseError: false },
    );
    const author = scoreCase(
      signed({ id: "author", split: "author", expectedCodes: ["self_harm_or_emergency"] }),
      [],
      { inputBlocked: false, outputBlocked: false, parseError: false },
    );
    const report = promotionReport([heldout, author], {
      modelId: "fake-gemini",
      temperature: 0,
      promptSha256: "abc",
    });
    expect(report.promotion).toBe("pass");
    expect(report.harmMisses).toBe(0);
    expect(report.review.map((row) => row.id)).toEqual(["author"]);
  });

  it("redacts the source before the call and drops a leaking model reply", async () => {
    const seen: string[] = [];
    const report = await runEval(
      [
        signed({
          id: "email",
          split: "heldout",
          expectedCodes: ["medication_danger"],
        }),
      ].map((row) => ({ ...row, source: "Email person@example.com about a wrong dose." })),
      {
        modelId: "fake-gemini",
        temperature: 0,
        complete: (prompt) => {
          seen.push(prompt);
          return Promise.resolve('{"reasonCodes":["medication_danger"]} person@example.com');
        },
      },
    );
    expect(seen[0]).toContain("[REDACTED_EMAIL]");
    expect(seen[0]).not.toContain("person@example.com");
    expect(report.cases[0]?.outputBlocked).toBe(true);
    expect(report.promotion).toBe("fail");
    expect(JSON.stringify(report)).not.toContain("person@example.com");
  });

  it("refuses the consumer Gemini host before any request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(() =>
      assertEvalEndpoint("https://generativelanguage.googleapis.com/v1beta/models"),
    ).toThrow(/BAA endpoint/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("parses known reason codes and flags an unreadable reply", () => {
    expect(parseReasonCodes('note {"reasonCodes":["false_reassurance","not_a_code"]}')).toEqual({
      codes: ["false_reassurance"],
      unknownCodes: ["not_a_code"],
      parseError: false,
    });
    expect(parseReasonCodes("no json").parseError).toBe(true);
  });
});
