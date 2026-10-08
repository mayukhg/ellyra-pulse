import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, HeartPulse, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getLiveDashboard } from "@/lib/live-dashboard";
import { MetricTooltip, SectionHeading } from "./shared";

function frustrationBand(value: number) {
  if (value >= 30) return { label: "red", className: "text-safety" };
  if (value >= 15) return { label: "amber", className: "text-passive" };
  return { label: "healthy", className: "text-promoter" };
}

function FrustrationShare({ label, value }: { label: string; value: number }) {
  const band = frustrationBand(value);
  return (
    <span>
      {label}{" "}
      <span className={cn("font-medium", band.className)}>
        {value}% {band.label}
      </span>
    </span>
  );
}

function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        up ? "text-promoter" : "text-detractor",
      )}
    >
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {up ? "+" : ""}
      {value}
      {suffix} MoM
    </span>
  );
}

export function Scorecard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { headline, medicalKpis, trend, operations } = getLiveDashboard();
  const dist = [
    { label: "Promoters (9-10)", value: headline.promoters, cls: "bg-promoter" },
    { label: "Passives (7-8)", value: headline.passives, cls: "bg-passive" },
    { label: "Detractors (0-6)", value: headline.detractors, cls: "bg-detractor" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-0 border-clinical/20 bg-gradient-to-br from-clinical/8 to-transparent p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <HeartPulse className="size-4 text-clinical" /> Overall NPS
            <MetricTooltip label="Overall NPS">
              Net Promoter Score equals the percentage of Promoters minus the percentage of
              Detractors. It ranges from −100 to +100; Passives count toward responses but not the
              formula.
            </MetricTooltip>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="font-mono text-6xl leading-none font-semibold text-foreground">
              +{headline.nps}
            </span>
            <Delta value={headline.momDelta} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                Relational
                <MetricTooltip label="Relational NPS">
                  Measures the patient’s overall relationship with Ellyra, independent of one
                  specific interaction or feature.
                </MetricTooltip>
              </div>
              <div className="font-mono text-lg font-semibold">+{headline.relational}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                Transactional
                <MetricTooltip label="Transactional NPS">
                  Measures sentiment immediately after a specific experience, such as parsing a
                  report or completing a symptom chat.
                </MetricTooltip>
              </div>
              <div className="font-mono text-lg font-semibold">+{headline.transactional}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                Response rate
                <MetricTooltip label="Response rate">
                  The percentage of delivered NPS surveys that received a valid 0–10 response in
                  the selected period.
                </MetricTooltip>
              </div>
              <div className="font-mono text-lg font-semibold">{headline.responseRate}%</div>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <div className="flex h-2.5 overflow-hidden rounded-full">
              {dist.map((d) => (
                <div key={d.label} className={d.cls} style={{ width: `${d.value}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {dist.map((d) => (
                <span key={d.label} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", d.cls)} />
                  {d.label} · {d.value}%
                </span>
              ))}
              <MetricTooltip label="NPS distribution">
                Promoters score 9–10, Passives score 7–8, and Detractors score 0–6. NPS subtracts
                the Detractor percentage from the Promoter percentage.
              </MetricTooltip>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              {headline.responses.toLocaleString()} responses this period · response rate{" "}
              {headline.responseRateDelta > 0 ? "+" : ""}
              {headline.responseRateDelta} pts MoM
            </p>
          </div>
        </Card>

        <Card className="gap-0 p-6 lg:col-span-2">
          <SectionHeading
            title="Relational vs. transactional trend"
            description="Measured by window. Aug is 23 Jul–21 Aug; Sep is the current 22 Aug–20 Sep window."
          />
          <div className="mt-4 h-[248px]">
            {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: -18, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gRel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--clinical)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--clinical)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gTrn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--promoter)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--promoter)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  domain={[30, 70]}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
                <Area
                  type="monotone"
                  dataKey="relational"
                  name="Relational NPS"
                  stroke="var(--clinical)"
                  fill="url(#gRel)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="transactional"
                  name="Transactional NPS"
                  stroke="var(--promoter)"
                  fill="url(#gTrn)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div>
        <SectionHeading
          title="Medical AI trust KPIs"
          description="Ellyra-specific measures that generic NPS cannot capture"
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {medicalKpis.map((k) => {
            const tone =
              k.status === "alarm"
                ? "border-safety/40 bg-safety/6"
                : k.status === "watch"
                  ? "border-passive/40 bg-passive/6"
                  : "border-promoter/35 bg-promoter/6";
            const valueTone =
              k.status === "alarm"
                ? "text-safety"
                : k.status === "watch"
                  ? "text-passive"
                  : "text-promoter";
            return (
              <Card key={k.key} className={cn("gap-0 p-5", tone)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
                      {k.abbrev}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-foreground">{k.label}</div>
                  </div>
                  <MetricTooltip label={k.label}>
                    {k.key === "ard" &&
                      "Anxiety Reduction Delta compares paired pre-report and post-report anxiety ratings. It is the share showing a positive shift; target >75%."}
                    {k.key === "ccs" &&
                      "Clinical Comprehension Score is the percentage of users who understood the explanation without a third-party search; target >85%."}
                    {k.key === "hallucination" &&
                      "The share of eligible clinical sessions with a mismatch code. The card alarms at or above 0.20%. Paging stays on each P0 response, not on this rate. The blurb splits the same rate by serving model."}
                    {k.key === "disclaimer" &&
                      "The share of feedback with negative sentiment about defensive legal or safety disclaimers; target <5%."}
                  </MetricTooltip>
                  {k.status === "alarm" ? (
                    <span className="strobe inline-flex items-center gap-1 rounded-full bg-safety px-2 py-0.5 text-[10px] font-semibold text-background">
                      <AlertTriangle className="size-3" /> ALARM
                    </span>
                  ) : k.status === "watch" ? (
                    <span className="rounded-full border border-passive/40 px-2 py-0.5 text-[10px] font-semibold text-passive">
                      WATCH
                    </span>
                  ) : (
                    <ShieldCheck className="size-4 text-promoter" />
                  )}
                </div>
                <div className={cn("mt-4 font-mono text-3xl font-semibold", valueTone)}>
                  {k.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {k.target} · {k.delta}
                </div>
                <p className="mt-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                  {k.blurb}
                </p>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="gap-0 p-5">
          <div className="text-xs font-medium text-muted-foreground">Median first contact</div>
          <div className="mt-2 font-mono text-2xl font-semibold">{operations.medianLabel}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {operations.medianDeltaMinutes === null
              ? "No prior window"
              : `${operations.medianDeltaMinutes > 0 ? "+" : ""}${operations.medianDeltaMinutes}m vs prior window`}
          </p>
        </Card>
        <Card className="gap-0 p-5">
          <div className="text-xs font-medium text-muted-foreground">Feedback close rate</div>
          <div className="mt-2 font-mono text-2xl font-semibold">{operations.closeRate}%</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {operations.resolved.toLocaleString()} of {operations.tickets.toLocaleString()} tickets
            {operations.closeRateDelta === null
              ? ""
              : ` · ${operations.closeRateDelta > 0 ? "+" : ""}${operations.closeRateDelta} pts`}
          </p>
        </Card>
        <Card className="gap-0 p-5">
          <div className="text-xs font-medium text-muted-foreground">Closed-loop SLAs</div>
          <div className="mt-2 font-mono text-sm font-semibold">
            P0 ≤15m {operations.p0Within15Pct ?? "—"}%
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {operations.p0OnTime} of {operations.p0Count} clinical pages · detractor ≤24h{" "}
            {operations.detractorWithin24Pct ?? "—"}% ({operations.csOnTime} of {operations.csCount})
          </p>
        </Card>
        <Card className="gap-0 p-5">
          <div className="text-xs font-medium text-muted-foreground">Frustration & PHI</div>
          <div className="mt-2 text-sm">
            <FrustrationShare label="Rage/dead clicks" value={operations.frustration.overall} />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <FrustrationShare label="Desktop" value={operations.frustration.desktop} />
            <FrustrationShare label="Mobile" value={operations.frustration.mobile} />
            <FrustrationShare label="Tablet" value={operations.frustration.tablet} />
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Amber from 15%, red from 30%. Persisted PHI leaks {operations.phiLeaks}. Quarantined{" "}
            {operations.quarantines}.
          </p>
        </Card>
      </div>

      <Card className="gap-0 p-5">
        <SectionHeading
          title="Survey funnel by cohort"
          description="Product telemetry sample. A drop is the sessions lost since the previous step."
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Cohort</th>
                {operations.funnel.map((step) => (
                  <th key={step.step} className="py-2 pr-4 font-medium">
                    {step.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {operations.funnelByCohort.map((cohort) => (
                <tr key={cohort.cohortKey} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium text-foreground">{cohort.cohortName}</td>
                  {cohort.steps.map((step) => (
                    <td key={step.step} className="py-2 pr-4 font-mono text-foreground">
                      {step.count.toLocaleString()}
                      {step.drop > 0 && (
                        <span className="ml-1 text-detractor">-{step.drop.toLocaleString()}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-2 pr-4 font-medium text-foreground">All sessions</td>
                {operations.funnel.map((step) => (
                  <td key={step.step} className="py-2 pr-4 font-mono text-foreground">
                    {step.count.toLocaleString()}
                    {step.drop > 0 && (
                      <span className="ml-1 text-detractor">-{step.drop.toLocaleString()}</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
