# Privacy Decision Record — Hotjar Behavioural Telemetry

**Status:** 🟡 DRAFT — decisions in §5 are open and require sign-off before Hotjar runs on any
surface used by real users or showing real feedback data.
**Owner:** _TBD (product/engineering)_ · **Privacy/DPO reviewer:** _TBD_ ·
**Clinical-safety reviewer:** _TBD_ · **Last updated:** 2026-10-08

This is a lightweight data-protection impact assessment for the Hotjar integration described in
[`docs/HOTJAR_TELEMETRY.md`](HOTJAR_TELEMETRY.md). It records *what* Hotjar can see, *why* that
is a risk for this product specifically, and the decisions that bound its use. Facts in §1–§4 are
current as of the date above; §5 is for the accountable owners to complete.

---

## 1. What is being processed

| Data | How it reaches Hotjar | Contains personal / health data? |
|---|---|---|
| Rendered DOM of every page where Hotjar runs (recordings, heatmap screenshots) | Passively, by the Hotjar script | **Yes, unless suppressed** — the dashboard renders patient verbatims, session telemetry, and simulator input |
| Mouse movement, clicks, scrolls, viewport, device/browser, approximate location | Passively | Pseudonymous behavioural data; personal data under GDPR |
| Custom events (`docs/HOTJAR_TELEMETRY.md` §4) | `trackHotjarEvent` | No — fixed strings only |
| Route pathnames | `stateChange` | No — pathname only, no query string |
| Hashed user ID + `account_tier`, `user_role`, `device` | `identifyUser` (harness only today) | Pseudonymous identifier |
| Hotjar cookies / local storage on the user's device | Hotjar script | Requires consent under UK/EU ePrivacy rules |

**Whose data:** today, internal workforce users of this dashboard (CS operators, clinical-safety
reviewers, administrators). Indirectly, **patients**, whose feedback text is displayed on the
Verbatims tab and the simulator.

## 2. Controls already in place

- `data-hj-suppress` on all verbatim text, the session-telemetry grid, and simulator input/output
  (full list: `docs/HOTJAR_TELEMETRY.md` §5).
- Identify attributes are restricted to flat primitives with a PII-key deny filter, and an
  allowlist is documented.
- Event names are fixed strings; no user text, IDs, or error messages are sent.
- Hotjar loads only in the browser and only when `VITE_HOTJAR_SITE_ID` is set — omitting it
  disables Hotjar entirely for a deployment.
- Dev tooling and synthetic fixtures are excluded from production builds.

## 3. Residual risks

| # | Risk | Severity | Notes |
|---|---|---|---|
| R1 | **No HIPAA Business Associate Agreement.** Hotjar does not offer one; its terms make the customer responsible for HIPAA applicability. Any PHI reaching Hotjar is an impermissible disclosure if HIPAA applies. | High | Same principle as `docs/DESIGN.md` §8's BAA requirement for LLM vendors. |
| R2 | **Suppression is opt-in per element.** A future component that renders verbatims or identifiers without `data-hj-suppress` leaks them silently. | High | Mitigated only by review checklist + QA scenario; no automated guard yet. |
| R3 | **No consent gating.** `initHotjar()` runs on every page load. UK GDPR / PECR and EU ePrivacy require prior consent for non-essential cookies and session recording. | High (UK/EU users) | The specs reference NHS numbers, implying UK users. |
| R4 | **Redaction is not guaranteed complete** (name heuristic — see README caveats), so "redacted" text is not safe to record. | Medium | Why redacted verbatims are suppressed too. |
| R5 | **Retention and deletion.** Recordings not tied to an identified user must be found and deleted manually. | Medium | Hotjar's User Lookup only finds identified sessions. |
| R6 | **Access.** Anyone with access to the Hotjar account sees all recordings and identify attributes. | Medium | |

## 4. Applicable requirements (from this repo's own specs)

- `docs/DESIGN_UI.md` §8 rule 9 — never place verbatim or session telemetry in analytics events.
- `docs/DESIGN_UI.md` §9.3 — exclude all sensitive values from … replay tools.
- `docs/DESIGN.md` §8 — third-party processors of feedback data need a BAA, or redaction strong
  enough that no PHI can reach them.

## 5. Decisions (to be completed and signed off)

### D1 — Where may Hotjar run?

- [ ] **(a) Nowhere in production** — dev/staging with synthetic data only.
- [ ] **(b) Production, but excluded from PHI-bearing surfaces** (Verbatims tab, Workflow
  simulator), e.g. by not initialising on those routes or calling Hotjar's opt-out there.
- [ ] **(c) Production everywhere, relying on `data-hj-suppress`.**
- [ ] **(d) Replace Hotjar with a vendor that signs a BAA.**

_Recommendation: (a) until D2–D4 are resolved; then (b). (c) is not compatible with R1 + R2 if
HIPAA applies. Rationale and decision: ____________________

### D2 — Does HIPAA apply to this deployment?

_Is Ellyra Health (or the deploying tenant) a covered entity or business associate for this data?
Answer and source: ____________________ — if yes, D1 must be (a), (b) with legal review, or (d)._

### D3 — Consent

- [ ] Gate `initHotjar()` behind the site's consent-management platform (CMP).
- [ ] Workforce-only tool: rely on an employee monitoring notice instead (confirm with DPO).

_Decision: ____________________ · Engineering follow-up: `initHotjar()` would accept a consent
check, and the provider would init on a consent-granted event._

### D4 — Retention, access, and account ownership

| Item | Decision |
|---|---|
| Hotjar data retention setting | _TBD_ |
| Who has Hotjar account access (roles, max seats) | _TBD_ |
| Account owner / offboarding responsibility | _TBD_ |
| DPA with Hotjar executed? (GDPR Art. 28) | _TBD_ |
| Process for deletion requests (User Lookup + manual) | _TBD_ |

### D5 — Ongoing assurance

- [ ] `data-hj-suppress` checklist (`docs/HOTJAR_TELEMETRY.md` §5.1) added to the PR template.
- [ ] QA scenario "P0 — behavioural telemetry never captures PHI" run on every release.
- [ ] Optional: an automated DOM test asserting every verbatim/session node is suppressed.

## 6. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner | | | |
| Privacy / DPO | | | |
| Clinical safety | | | |
| Engineering | | | |
