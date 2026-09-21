import { useEffect, useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  ClipboardList,
  EyeOff,
  Loader2,
  ShieldAlert,
  Sparkles,
  Brain,
  Play,
  RotateCcw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Chip, SectionHeading } from "./shared";

const SAMPLES = [
  "The lab report parsed my glucose wrong, my doctor said I was fine but this panicked me",
  "Loved how simple the explanation was, gave me questions for my GP!",
  "It was okay, but every answer buried the point under legal disclaimers",
];

const RISK_WORDS = ["wrong", "panicked", "misread", "incorrect", "contradict", "a&e", "emergency"];
const REDACT_PATTERNS: [RegExp, string][] = [
  [/\b\d{2}\/\d{2}\/\d{4}\b/g, "[REDACTED_DOB]"],
  [/\bMRN[- ]?\d+\b/gi, "[REDACTED_MRN]"],
  [/\b(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+[A-Z][a-z]+/g, "[REDACTED_NAME]"],
  [/\bmy (?:name is|doctor)\b/gi, "my [REDACTED_NAME]"],
];

type Result = {
  redacted: string;
  redactionCount: number;
  risk: boolean;
  sentiment: number;
  aspects: string[];
  action: string;
  actionDetail: string;
  tone: "safety" | "warn" | "good" | "clinical";
};

function classify(input: string): Result {
  const lower = input.toLowerCase();
  let redacted = input;
  let count = 0;
  for (const [re, token] of REDACT_PATTERNS) {
    redacted = redacted.replace(re, () => {
      count += 1;
      return token;
    });
  }
  const risk = RISK_WORDS.some((w) => lower.includes(w));
  const positiveHits = ["loved", "great", "simple", "helpful", "thank", "calm", "clear"].filter(
    (w) => lower.includes(w),
  ).length;
  const negativeHits = [
    "wrong",
    "panicked",
    "confusing",
    "slow",
    "expensive",
    "disclaimer",
    "buried",
    "frustrat",
  ].filter((w) => lower.includes(w)).length;
  const sentiment = Math.max(
    -1,
    Math.min(1, (positiveHits - negativeHits) / Math.max(1, positiveHits + negativeHits)),
  );

  const aspects: string[] = [];
  if (/glucose|report|pars|ocr|marker|decimal/i.test(input))
    aspects.push("Document Parsing / OCR Quality");
  if (/doctor|wrong|trust|accurate|fine/i.test(input)) aspects.push("Clinical Trust");
  if (/disclaimer|tone|kind|cold|lectur/i.test(input)) aspects.push("Tone & Bedside Manner");
  if (/questions|gp|next step|actionab/i.test(input)) aspects.push("Actionability");
  if (/price|cost|subscription|£|\$/i.test(input)) aspects.push("Billing / Cost");
  if (aspects.length === 0) aspects.push("Clinical Trust");

  if (risk)
    return {
      redacted,
      redactionCount: count,
      risk,
      sentiment,
      aspects,
      action: "P0 Clinical On-Call Page",
      actionDetail: "Paged clinical on-call · 15 min acknowledgement SLA · safety audit opened",
      tone: "safety",
    };
  if (sentiment <= -0.2)
    return {
      redacted,
      redactionCount: count,
      risk,
      sentiment,
      aspects,
      action: "CS Ticket",
      actionDetail: "Detractor ticket created · 24h first-contact SLA",
      tone: "warn",
    };
  if (sentiment >= 0.5)
    return {
      redacted,
      redactionCount: count,
      risk,
      sentiment,
      aspects,
      action: "Review Conversion Prompt",
      actionDetail: "App Store / Trustpilot prompt queued for next session",
      tone: "good",
    };
  return {
    redacted,
    redactionCount: count,
    risk,
    sentiment,
    aspects,
    action: "In-session Micro-poll",
    actionDetail: "Passive follow-up micro-poll scheduled",
    tone: "clinical",
  };
}

const STEPS = [
  { key: "gate", label: "Clinical risk gate", icon: ShieldAlert },
  { key: "phi", label: "Automated PHI redaction", icon: EyeOff },
  { key: "absa", label: "LLM ABSA & safety classifier", icon: Brain },
  { key: "route", label: "Closed-loop routing decision", icon: ClipboardList },
] as const;

export function Simulator() {
  const [input, setInput] = useState(SAMPLES[0]);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), 850);
    return () => clearTimeout(t);
  }, [step]);

  const run = () => {
    if (!input.trim()) return;
    setResult(classify(input));
    setStep(0);
  };

  const done = step >= STEPS.length;

  return (
    <Card className="gap-0 p-5">
      <SectionHeading
        title="Closed-loop workflow simulator"
        description="Submit a test NPS verbatim and watch the safety, redaction, and routing pipeline run"
      />

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            placeholder="Paste a patient verbatim…"
            className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-clinical"
          />
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setInput(s);
                  setStep(-1);
                  setResult(null);
                }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              >
                Sample {i + 1}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={run}
              className="inline-flex items-center gap-1.5 rounded-md bg-clinical px-3.5 py-2 text-sm font-semibold text-clinical-foreground hover:opacity-90"
            >
              <Play className="size-4" /> Run pipeline
            </button>
            <button
              onClick={() => {
                setStep(-1);
                setResult(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <RotateCcw className="size-4" /> Reset
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {STEPS.map((s, i) => {
            const state = step < 0 ? "idle" : i < step ? "done" : i === step ? "running" : "idle";
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border p-3 transition-all",
                  state === "running" && "border-clinical bg-clinical/8",
                  state === "done" && "bg-muted/40",
                  state === "idle" && "opacity-55",
                )}
              >
                <span className="mt-0.5">
                  {state === "running" ? (
                    <Loader2 className="size-4 animate-spin text-clinical" />
                  ) : state === "done" ? (
                    <CheckCircle2 className="size-4 text-promoter" />
                  ) : (
                    <Icon className="size-4 text-muted-foreground" />
                  )}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{s.label}</div>
                  {state === "done" && result && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.key === "gate" &&
                        (result.risk
                          ? "Risk language detected — escalation path armed"
                          : "No clinical risk language detected")}
                      {s.key === "phi" &&
                        `${result.redactionCount} PHI span${result.redactionCount === 1 ? "" : "s"} redacted before storage`}
                      {s.key === "absa" && (
                        <span className="flex flex-wrap gap-1 pt-1">
                          <Chip tone={result.sentiment >= 0 ? "good" : "safety"}>
                            sentiment {result.sentiment > 0 ? "+" : ""}
                            {result.sentiment.toFixed(2)}
                          </Chip>
                          {result.aspects.map((a) => (
                            <Chip key={a} tone="clinical">
                              {a}
                            </Chip>
                          ))}
                        </span>
                      )}
                      {s.key === "route" && result.actionDetail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {done && result && (
            <div
              className={cn(
                "rounded-xl border p-4",
                result.tone === "safety"
                  ? "strobe border-safety/50 bg-safety/8"
                  : result.tone === "good"
                    ? "border-promoter/40 bg-promoter/8"
                    : result.tone === "warn"
                      ? "border-passive/40 bg-passive/8"
                      : "border-clinical/40 bg-clinical/8",
              )}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {result.tone === "safety" ? (
                  <AlertOctagon className="size-4 text-safety" />
                ) : result.tone === "good" ? (
                  <Sparkles className="size-4 text-promoter" />
                ) : (
                  <ClipboardList className="size-4 text-clinical" />
                )}
                Routed: {result.action}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{result.actionDetail}</p>
              <p className="mt-3 rounded-md border border-border bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
                stored: {result.redacted}
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
