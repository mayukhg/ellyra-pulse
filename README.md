# Ellyra Pulse

Build the interactive prototype for Ellyra Health's Customer NPS Tracker & Sentiment Intelligence Platform based on the comprehensive specification from https://github.com/mayukhg/customer-nps-tracker (docs/DESIGN.md).

### Product & Clinical Context
Ellyra Health (ellyra.health) is a B2C medical AI product providing symptom checking, medical imaging/condition analysis, and lab/blood report summarization. Medical feedback carries sensitive PHI and life-critical trust implications.

### Key Screens & Interactive Capabilities:

1. **Executive Scorecard & Specialized Medical AI Metrics**:
   - Overall NPS score with MoM trend, relational vs. transactional breakdown, response rate, and distribution (Promoters, Passives, Detractors).
   - Medical AI KPI cards:
     * **Anxiety Reduction Delta (ARD)**: Pre- vs. Post-report anxiety shift (Target >75% positive shift).
     * **Clinical Comprehension Score (CCS)**: Understanding explanation without third-party search (Target >85%).
     * **Hallucination / Inaccuracy Flag Rate**: % of sessions reporting conflict with clinical advice (Target <0.2%, alarmed status).
     * **Disclaimer Fatigue Index**: % of mentions frustrated by defensive legal disclaimers (Target <5%).

2. **Feature-Level NPS Breakdown Table**:
   - Compare transactional NPS across features:
     * Lab / Blood Report Parser (+62 NPS, Top driver: Clarity of markers)
     * MRI / Imaging Insights (+48 NPS, Top driver: Needs deeper detail)
     * Symptom Chat Companion (+51 NPS, Top driver: Empathetic bedside manner)
     * GP Question Builder (+71 NPS, Top driver: High actionability)
   - Interactive row clicks to filter the dashboard by feature.

3. **Deep-Dive Root-Cause Quadrant Analysis (Scatter Plot)**:
   - Interactive 2x2 matrix plotting **Feedback Volume** (X-axis) vs. **Impact on Net Sentiment** (Y-axis):
     * *High Vol, High Impact*: Systemic priorities (e.g. Tone & Bedside Manner in chat)
     * *High Vol, Low Impact*: Usability/polish (e.g. Minor UI confusion)
     * *Low Vol, High Impact (Critical Quadrant)*: Rare trust-destroying failures (e.g. OCR decimal/unit misread, missed abnormal marker) flagged for immediate safety audit
     * *Low Vol, Low Impact*: Noise/monitoring
   - Interactive dots that filter verbatims on click.

4. **Aspect-Based Sentiment Tagging (ABSA) Explorer**:
   - Taxonomy breakdown: Clinical Trust, Tone & Bedside Manner, Document Parsing / OCR Quality, Actionability, plus operational tags (Billing/Cost, UI Confusion, Response Speed).
   - Polarity bars (Positive vs. Negative sentiment) per aspect.

5. **Real-time Verbatim & Closed-Loop Operations Hub**:
   - Feed of patient feedback with PHI Redaction badges (e.g. `[REDACTED_DOB]`, `[REDACTED_NAME]`, `[REDACTED_MRN]`).
   - Sentiment score (-1.0 to +1.0) and NPS tier pill.
   - Closed-loop action routing badges and SLA status:
     * Detractors (0-6) -> CS Ticket with 24h SLA and status (`Open`, `Contacted`, `Resolved`).
     * Safety Flags -> Immediate P0 Clinical On-Call Escalation with red strobe alert badge.
     * Promoters -> App Store / Trustpilot review conversion flow.
     * Passives -> In-session micro-poll.
   - Filterable by: Feature, Sentiment polarity, Aspect tag, Safety risk, and SLA status.
   - Modal/drawer to inspect session telemetry, model version, and trigger closed-loop actions.

6. **Interactive Workflow Simulator**:
   - A sandbox modal or tab where users can submit a test NPS response (e.g., "The lab report parsed my glucose wrong, my doctor said I was fine but this panicked me" or "Loved how simple the explanation was, gave me questions for my GP!").
   - Live visual simulation showing:
     1. Clinical Risk Gate check
     2. Automated PHI Redaction step
     3. LLM ABSA & Safety classifier running
     4. Automated routing decision (P0 Clinical Page, CS Ticket, or Review prompt).

### Visual Design & Polish:
- High-trust, modern clinical SaaS styling: clean slate/neutral canvas, clinical teal accents, amber warning, coral red for safety alerts, and deep emerald for promoters.
- Tailwind CSS, Lucide icons, interactive charts (Recharts), and responsive tabbed navigation. Include rich pre-populated realistic mock data demonstrating all edge cases.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/16327ac0-e281-42d9-8416-3ae3b09541c7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
