# Evaluation

Two different checks exist. Neither one is a clinician-signed release gate for Gemini.

## What runs today

| Check | Command | What it decides |
|---|---|---|
| Quota verifier | `bun scripts/verify-synthetic-quotas.ts` | The synthetic corpus still hits the counts in `src/backend/synthetic/quotas.ts` |
| Dashboard tests | `bun run test` | Demo-window metrics match `docs/METRICS.md` |
| Ingestion tests | `bun run test` | Redaction, the deterministic safety gate, lexicon ABSA, routing, auth, paging, shadow mode |
| Gemini harness | `bun run eval:gemini` | The gold set is well formed. With no endpoint configured, it does not call a model |

Shadow mode (`INGESTION_MODE=shadow`) runs redaction, the safety gate, lexicon ABSA, and routing, then discards the result. It does not call Gemini and it does not score a model version.

Lexicon ABSA (`lexicon-absa-v1`) and the safety gate (`deterministic-safety-v1`) are checked with a handful of hand-written sentences in `src/backend/ingestion/__tests__/`. Those tests are not a gold set. The safety gate remains the P0 authority. An eval result must not clear a page.

## Gemini harness

Closed Gemini is scored as a black box. The judge is local code in `src/backend/eval/score.ts`. A second model is not asked to grade the first. Free-text similarity is not used.

The pinned instruction is `EVAL_PROMPT_TEMPLATE` in `src/backend/eval/prompt.ts`. The case text is appended as data. `bun run eval:gemini` prints the SHA-256 of that template. Change the wording and the hash changes.

Each case asks for JSON only: `{"reasonCodes":[...]}`. Allowed codes are the seven `SAFETY_REASON_CODES` in `src/backend/contracts.ts`. The four mismatch codes and the three harm codes are the same lists the hallucination rate and the safety gate use.

Before the call, `redact` and `verifyNoLeakage` run on the source. A leak skips the call. After the call, the same leakage check runs on the model text. A leak drops the text and fails that case. The report stores case ids and codes. It does not store the source or the model text.

### Promotion

| Row | Counts toward release |
|---|---|
| `split: "author"` | No. Prompt authors may read these |
| `labelStatus: "draft"` | No. Engineering labels are not a sign-off |
| `split: "heldout"` and `labelStatus: "signed"` | Yes |

On the signed held-out rows, any missed expected code fails the run. A missed harm code and a missed mismatch code both fail. A leakage failure or an unreadable reply on those rows also fails. Extra predicted codes are listed under `review` for a person and do not fail the run. Gemini is not asked to judge them.

The live hallucination alarm of 0.20% is a population rate (`docs/METRICS.md`). It is not the pass bar for this set.

The committed cases in `src/backend/eval/goldCases.ts` are all `draft`. Fifteen synthetic sources cover every harm code and every mismatch code on the held-out split. Because none are signed, a run cannot promote a version.

```bash
bun run eval:gemini
```

With `GEMINI_EVAL_ENDPOINT` unset, the command checks the set, prints `promotion: blocked (no signed held-out cases)`, and exits 0. It does not call a network.

Exit codes once an endpoint is set:

| Code | Meaning |
|---|---|
| 0 | Signed held-out cases passed |
| 1 | Signed held-out cases failed, or the endpoint was refused |
| 2 | The model ran, but nothing signed is available to promote against |

### Endpoint

Set these only for an HTTPS Gemini `generateContent` URL covered by a business associate agreement. See `docs/DESIGN.md` §8. The consumer host `generativelanguage.googleapis.com` is refused before any request, as is `ai.google.dev`.

```
GEMINI_EVAL_ENDPOINT
GEMINI_EVAL_API_KEY
GEMINI_EVAL_MODEL
GEMINI_EVAL_TEMPERATURE   # default 0
```

The key stays in the environment. It is not read by the dashboard. CI runs `bun scripts/eval-gemini.ts` without those variables, so CI validates the set and does not call Gemini.

Signing a case is a clinician action: change `labelStatus` to `"signed"` on held-out rows only after review. Do not paste live patient text into `goldCases.ts`.

## After a version is serving

The dashboard does not decide the pre-release gate. It watches the version that already served. `hallucinationByModel` on the executive response splits the hallucination flag rate by `model_version` on `fact_clinical_session`. The scorecard blurb shows that split. A version the gold set never saw still appears there once sessions carry its id.
