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
import { headline, medicalKpis, npsTrend } from "@/lib/nps-data";
import { SectionHeading } from "./shared";

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
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="font-mono text-6xl leading-none font-semibold text-foreground">
              +{headline.nps}
            </span>
            <Delta value={headline.momDelta} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Relational</div>
              <div className="font-mono text-lg font-semibold">+{headline.relational}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Transactional</div>
              <div className="font-mono text-lg font-semibold">+{headline.transactional}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Response rate</div>
              <div className="font-mono text-lg font-semibold">{headline.responseRate}%</div>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <div className="flex h-2.5 overflow-hidden rounded-full">
              {dist.map((d) => (
                <div key={d.label} className={d.cls} style={{ width: `${d.value}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {dist.map((d) => (
                <span key={d.label} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", d.cls)} />
                  {d.label} · {d.value}%
                </span>
              ))}
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
            description="Rolling 7-month NPS by survey type"
          />
          <div className="mt-4 h-[248px]">
            {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={npsTrend} margin={{ left: -18, right: 8, top: 8 }}>
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
                <Legend wrapperStyle={{ fontSize: 12 }} />
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
    </div>
  );
}
