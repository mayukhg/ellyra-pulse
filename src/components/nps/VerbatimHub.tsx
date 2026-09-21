import { useMemo, useState } from "react";
import {
  AlertOctagon,
  ClipboardList,
  MessageSquareQuote,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ASPECTS,
  FEATURES,
  verbatims,
  type Aspect,
  type Feature,
  type Verbatim,
} from "@/lib/nps-data";
import { Chip, SectionHeading, TierPill, redactText } from "./shared";

type Polarity = "all" | "positive" | "negative";
type SlaFilter = "all" | "Open" | "Contacted" | "Resolved" | "Escalated";

const actionTone = {
  "P0 Clinical Page": "safety",
  "CS Ticket": "warn",
  "Review Prompt": "good",
  "Micro-poll": "clinical",
} as const;

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function VerbatimHub({
  featureFilter,
  onFeatureFilter,
  aspectFilter,
  onAspectFilter,
  themeFilter,
}: {
  featureFilter: Feature | null;
  onFeatureFilter: (f: Feature | null) => void;
  aspectFilter: Aspect | null;
  onAspectFilter: (a: Aspect | null) => void;
  themeFilter: { theme: string; feature: Feature; aspect: Aspect } | null;
}) {
  const [polarity, setPolarity] = useState<Polarity>("all");
  const [safetyOnly, setSafetyOnly] = useState(false);
  const [sla, setSla] = useState<SlaFilter>("all");
  const [open, setOpen] = useState<Verbatim | null>(null);

  const effFeature = themeFilter?.feature ?? featureFilter;
  const effAspect = themeFilter?.aspect ?? aspectFilter;

  const rows = useMemo(
    () =>
      verbatims.filter((v) => {
        if (effFeature && v.feature !== effFeature) return false;
        if (effAspect && !v.aspects.includes(effAspect)) return false;
        if (polarity === "positive" && v.sentiment <= 0) return false;
        if (polarity === "negative" && v.sentiment >= 0) return false;
        if (safetyOnly && !v.safety) return false;
        if (sla !== "all" && v.sla !== sla) return false;
        return true;
      }),
    [effFeature, effAspect, polarity, safetyOnly, sla],
  );

  return (
    <Card className="gap-0 p-5">
      <SectionHeading
        title="Verbatim & closed-loop operations hub"
        description="PHI-redacted feedback with routing, SLA state, and session telemetry"
        right={
          <span className="font-mono text-xs text-muted-foreground">
            {rows.length} of {verbatims.length} responses
          </span>
        }
      />

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <Select
          label="Feature"
          value={effFeature ?? "All features"}
          onChange={(v) => onFeatureFilter(v === "All features" ? null : (v as Feature))}
          options={["All features", ...FEATURES]}
        />
        <Select
          label="Aspect tag"
          value={effAspect ?? "All aspects"}
          onChange={(v) => onAspectFilter(v === "All aspects" ? null : (v as Aspect))}
          options={["All aspects", ...ASPECTS]}
        />
        <Select
          label="Sentiment"
          value={polarity}
          onChange={(v) => setPolarity(v as Polarity)}
          options={["all", "positive", "negative"]}
        />
        <Select
          label="SLA status"
          value={sla}
          onChange={(v) => setSla(v as SlaFilter)}
          options={["all", "Open", "Contacted", "Resolved", "Escalated"]}
        />
        <button
          onClick={() => setSafetyOnly((s) => !s)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
            safetyOnly
              ? "border-safety bg-safety/12 text-safety"
              : "border-border text-muted-foreground hover:bg-accent",
          )}
        >
          <ShieldAlert className="mr-1 inline size-3.5" />
          Safety risk only
        </button>
        {themeFilter && (
          <Chip tone="clinical">Theme: {themeFilter.theme}</Chip>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((v) => (
          <button
            key={v.id}
            onClick={() => setOpen(v)}
            className={cn(
              "w-full rounded-xl border border-border p-4 text-left transition-colors hover:border-clinical/50 hover:bg-clinical/4",
              v.safety && "border-safety/40 bg-safety/4",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <TierPill tier={v.tier} score={v.score} />
              <Chip tone="neutral">{v.feature}</Chip>
              <Chip tone="neutral">{v.surveyType}</Chip>
              {v.safety && (
                <span className="strobe inline-flex items-center gap-1 rounded-full bg-safety px-2 py-0.5 text-[10px] font-semibold text-background">
                  <AlertOctagon className="size-3" /> SAFETY FLAG
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {v.id} · {v.received}
              </span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-foreground">{redactText(v.text)}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone={v.sentiment >= 0 ? "good" : "safety"}>
                sentiment {v.sentiment > 0 ? "+" : ""}
                {v.sentiment.toFixed(2)}
              </Chip>
              {v.aspects.map((a) => (
                <Chip key={a} tone="clinical">
                  {a}
                </Chip>
              ))}
              {v.redactions.length > 0 && (
                <Chip tone="neutral">PHI redacted ×{v.redactions.length}</Chip>
              )}
              <span className="ml-auto flex items-center gap-2">
                <Chip tone={actionTone[v.action]}>
                  {v.action === "P0 Clinical Page" ? (
                    <ShieldAlert className="size-3" />
                  ) : v.action === "CS Ticket" ? (
                    <ClipboardList className="size-3" />
                  ) : v.action === "Review Prompt" ? (
                    <Sparkles className="size-3" />
                  ) : (
                    <MessageSquareQuote className="size-3" />
                  )}
                  {v.action}
                </Chip>
                {v.sla !== "N/A" && (
                  <Chip
                    tone={
                      v.sla === "Resolved"
                        ? "good"
                        : v.sla === "Escalated"
                          ? "safety"
                          : v.sla === "Open"
                            ? "warn"
                            : "neutral"
                    }
                  >
                    <Timer className="size-3" />
                    {v.sla} · {v.slaDue}
                  </Chip>
                )}
              </span>
            </div>
          </button>
        ))}
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No responses match these filters.
          </div>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono">{open.id}</span>
                  <TierPill tier={open.tier} score={open.score} />
                </DialogTitle>
                <DialogDescription>
                  {open.feature} · {open.channel}
                </DialogDescription>
              </DialogHeader>

              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed">
                {redactText(open.text)}
              </p>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {[
                  ["Session ID", open.sessionId],
                  ["Model version", open.modelVersion],
                  ["Device", open.device],
                  ["Survey type", open.surveyType],
                  ["Sentiment", open.sentiment.toFixed(2)],
                  ["SLA", `${open.sla} · ${open.slaDue}`],
                ].map(([k, val]) => (
                  <div key={k} className="flex flex-col">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-mono text-foreground">{val}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {open.safety && (
                  <button
                    onClick={() => toast.error("P0 page sent to clinical on-call (15 min SLA)")}
                    className="rounded-md bg-safety px-3 py-2 text-xs font-semibold text-background"
                  >
                    Page clinical on-call
                  </button>
                )}
                {open.tier === "detractor" && (
                  <button
                    onClick={() => toast.success("CS ticket created · 24h SLA started")}
                    className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
                  >
                    Create CS ticket
                  </button>
                )}
                {open.tier === "promoter" && (
                  <button
                    onClick={() => toast.success("App Store review prompt queued")}
                    className="rounded-md bg-promoter px-3 py-2 text-xs font-semibold text-background"
                  >
                    Send review prompt
                  </button>
                )}
                {open.tier === "passive" && (
                  <button
                    onClick={() => toast.success("In-session micro-poll scheduled")}
                    className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
                  >
                    Schedule micro-poll
                  </button>
                )}
                <button
                  onClick={() => toast("Marked for weekly safety audit review")}
                  className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
                >
                  Add to safety audit
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
