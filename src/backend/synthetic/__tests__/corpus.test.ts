import { describe, expect, it } from "vitest";
import { buildCorpus } from "../buildCorpus";
import { stableId } from "../ids";
import { DEFAULT_SEED } from "../quotas";
import { verifyCorpus } from "../verify";

describe("synthetic corpus", () => {
  it("returns the same ids for the same seed", () => {
    expect(stableId(DEFAULT_SEED, "response:demo", 0)).toBe(
      stableId(DEFAULT_SEED, "response:demo", 0),
    );
    const first = buildCorpus();
    const second = buildCorpus();
    expect(second.responses[0]?.responseId).toBe(first.responses[0]?.responseId);
    expect(second.responses.length).toBe(first.responses.length);
    expect(second.sessions.length).toBe(first.sessions.length);
  });

  it("meets the quota contract", () => {
    const result = verifyCorpus(buildCorpus());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  }, 30_000);
});
