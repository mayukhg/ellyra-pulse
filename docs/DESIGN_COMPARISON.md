# Design Comparison: Engineering-First vs. Clinical-Context Blueprint

Comparison of `docs/DESIGN.md` ("Design A") against an alternative clinically-framed design
("Design B") proposed for the same problem. Interactive version:
https://claude.ai/artifact/AdbbtgXVMZUQbBeB21acfg

**Summary:** Design B is the stronger *product/clinical* thinking — it treats sentiment as a
trust-and-safety signal specific to a medical AI companion, with a pre-emptive clinical risk
gate, ABSA-based verbatim analysis, medically-literate KPIs, and a ready-to-build dashboard
wireframe. Design A is the stronger *system to build* — it has a concrete data schema,
orchestration tooling choice, phased delivery plan, and repo structure. Recommendation: build
A's skeleton, carrying B's clinical judgment on top (see §3).

## 1. Comparison Matrix

| Dimension | Design A | Design B | Verdict |
|---|---|---|---|
| Survey trigger gating | Safety-flag detection happens *after* free text is submitted, as one enrichment classifier among several. | A dedicated **clinical risk filter** runs *before* any survey fires — a red-flag session never sees a standard NPS prompt. | **B** — pre-emptive gating is the safer default when the product is interpreting lab results and symptoms. |
| Trigger context | Generic events (N days post-consult, quarterly pulse). | Feature-specific "aha" moments (report viewed, chat closed) with tailored question copy. | **B** — reads as more relevant, less like a generic survey. |
| Verbatim taxonomy | General theme set (accuracy, speed, UI, cost, escalation, trust). | ABSA on five medical-specific axes (clinical trust, tone, OCR/parsing, actionability) plus a volume-vs-impact **root-cause quadrant**. | **B** — sharper prioritization than flat theme frequency. |
| Headline metrics | NPS, response rate, sentiment-vs-NPS divergence, close-the-loop rate, safety-flag count. | Adds relational vs. transactional NPS, Anxiety Reduction Delta, Clinical Comprehension Score, Hallucination/Inaccuracy Flag Rate, Disclaimer Fatigue Index. | **B** — measures trust and comprehension, not just satisfaction. |
| Dashboard spec form | Prose spec of views + tool recommendation. | Concrete ASCII wireframe (scorecards, feature-level table, alert feed). | **B** — immediately buildable by a designer/engineer. |
| Compliance depth | PHI redaction, BAA requirement, access-logged store, retention policy. | Same, plus an explicit **clinical triage guardrail**: acute-risk language suppresses marketing outreach and fires an in-product emergency-helpline banner. | **B** — closes a real safety gap A doesn't address. |
| Data warehouse schema | Explicit `fact_nps_response`/`dim_user`/`dim_theme` tables with fields and a PHI-reference pointer pattern. | Not specified. | **A** — the concrete foundation B's dashboard/quadrant analysis needs. |
| Orchestration & tooling | Names a stack (n8n for routing, Step Functions/Temporal for the safety-critical path) with rationale. | Describes routing logic, doesn't commit to a tool. | **A** — saves a decision cycle. |
| Phased delivery plan | Explicit MVP → Phase 2 → Phase 3. | No phasing; reads as a target-state architecture. | **A** — B's larger scope needs a shipping order. |
| Repo/engineering structure | Proposes a concrete repo layout. | Not addressed. | **A** — directly usable for this repo. |
| Promoter/detractor routing | Detractor→ticket+SLA, promoter→review ask, repeat detractor→churn flag. | Same three paths, plus a passive-cohort micro-poll A lacks. | **Tie** — fold B's micro-poll into A. |

## 2. Score

- Design B leads on: 4 dimensions (clinical/product nuance)
- Design A leads on: 4 dimensions (execution readiness)
- Tied: 2 dimensions

## 3. Recommended Synthesis

**Keep from Design A:**
- Warehouse schema (`fact_nps_response`/`dim_user`/`dim_theme`), extended with a `feature`
  column so B's feature-level NPS table has something to group by.
- Orchestration choice: n8n for routing, a durable engine reserved for the safety-critical path.
- Phased roadmap: MVP → ABSA/quadrant/new-KPIs in Phase 2/3.
- Repo layout: `ingestion/`, `enrichment/`, `routing/`, `warehouse/`, `dashboard/`.

**Adopt from Design B:**
- Move the clinical risk filter to the *front* of the pipeline, before any survey trigger fires.
- Replace the generic theme list with ABSA taxonomy (clinical trust, tone, OCR-parsing,
  actionability) plus the volume-vs-impact root-cause quadrant.
- Add Anxiety Reduction Delta, Clinical Comprehension Score, Hallucination/Inaccuracy Flag Rate,
  and Disclaimer Fatigue Index to the metric set in `docs/DESIGN.md` §6.
- Add an in-product emergency-helpline banner for acute-risk language, not just an internal alert.
- Add a passive-tier (7–8) micro-poll ("what was missing?") to the routing table in §4.4.

These changes should be folded into `docs/DESIGN.md` directly rather than maintained as a
separate document once agreed.
