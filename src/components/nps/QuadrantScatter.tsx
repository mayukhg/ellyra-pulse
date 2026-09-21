import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { AlertOctagon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { quadrantPoints, type Feature, type QuadrantPoint } from "@/lib/nps-data";
import { Chip, SectionHeading } from "./shared";

const VOL_MID = 300;
const IMPACT_MID = 0;

function quadrantOf(p: QuadrantPoint) {
  const highVol = p.volume >= VOL_MID;
  const highImpact = Math.abs(p.impact) >= 4;
  if (highVol && highImpact) return "Systemic priority";
  if (highVol && !highImpact) return "Usability polish";
  if (!highVol && highImpact) return "Critical / rare trust failure";
  return "Monitoring noise";
}

export function QuadrantScatter({
  featureFilter,
  selected,
  onSelect,
}: {
  featureFilter: Feature | null;
  selected: QuadrantPoint | null;
  onSelect: (p: QuadrantPoint | null) => void;
}) {
  const data = quadrantPoints.filter((p) => !featureFilter || p.feature === featureFilter);

  return (
    <Card className="gap-0 p-5">
      <SectionHeading
        title="Root-cause quadrant analysis"
        description="Feedback volume vs. impact on net sentiment. Click a dot to filter verbatims."
        right={
          selected && (
            <button
              onClick={() => onSelect(null)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Clear theme filter
            </button>
          )
        }
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="relative h-[380px] rounded-lg border border-border bg-canvas/60 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, bottom: 22, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="volume"
                name="Feedback volume"
                domain={[0, 1000]}
                tickLine={false}
                fontSize={11}
                stroke="var(--muted-foreground)"
                label={{
                  value: "Feedback volume →",
                  position: "insideBottom",
                  offset: -12,
                  fontSize: 11,
                  fill: "var(--muted-foreground)",
                }}
              />
              <YAxis
                type="number"
                dataKey="impact"
                name="Impact on net sentiment"
                domain={[-11, 8]}
                tickLine={false}
                fontSize={11}
                stroke="var(--muted-foreground)"
              />
              <ZAxis type="number" dataKey="volume" range={[70, 340]} />
              <ReferenceLine x={VOL_MID} stroke="var(--border)" strokeDasharray="5 5" />
              <ReferenceLine y={IMPACT_MID} stroke="var(--border)" strokeDasharray="5 5" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "var(--popover-foreground)",
                }}
                formatter={(v: number, n: string) => [v, n]}
                labelFormatter={() => ""}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as QuadrantPoint | undefined;
                  if (!p) return null;
                  return (
                    <div className="max-w-[240px] rounded-lg border border-border bg-popover p-3 text-xs shadow-md">
                      <div className="font-semibold text-popover-foreground">{p.theme}</div>
                      <div className="mt-1 font-mono text-muted-foreground">
                        {p.volume} mentions · impact {p.impact > 0 ? "+" : ""}
                        {p.impact}
                      </div>
                      <div className="mt-1 text-muted-foreground">{quadrantOf(p)}</div>
                    </div>
                  );
                }}
              />
              <Scatter data={data} onClick={(p) => onSelect(p as unknown as QuadrantPoint)}>
                {data.map((p) => (
                  <Cell
                    key={p.id}
                    fill={
                      p.critical
                        ? "var(--safety)"
                        : p.impact > 0
                          ? "var(--promoter)"
                          : "var(--clinical)"
                    }
                    fillOpacity={selected && selected.id !== p.id ? 0.25 : 0.75}
                    stroke={selected?.id === p.id ? "var(--foreground)" : "transparent"}
                    strokeWidth={2}
                    className="cursor-pointer"
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-clinical/25 bg-clinical/6 p-2.5">
              <div className="font-semibold text-clinical">Low vol · High impact</div>
              <div className="text-muted-foreground">Critical trust failures — safety audit</div>
            </div>
            <div className="rounded-lg border border-border p-2.5">
              <div className="font-semibold text-foreground">High vol · High impact</div>
              <div className="text-muted-foreground">Systemic roadmap priorities</div>
            </div>
            <div className="rounded-lg border border-border p-2.5">
              <div className="font-semibold text-foreground">Low vol · Low impact</div>
              <div className="text-muted-foreground">Noise / monitoring</div>
            </div>
            <div className="rounded-lg border border-border p-2.5">
              <div className="font-semibold text-foreground">High vol · Low impact</div>
              <div className="text-muted-foreground">Usability & polish backlog</div>
            </div>
          </div>
          <div className="max-h-[248px] space-y-2 overflow-y-auto pr-1">
            {data.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(selected?.id === p.id ? null : p)}
                className={cn(
                  "w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent",
                  selected?.id === p.id && "border-clinical bg-clinical/8",
                  p.critical && "border-safety/35",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{p.theme}</span>
                  {p.critical && (
                    <Chip tone="safety">
                      <AlertOctagon className="size-3" /> CRITICAL
                    </Chip>
                  )}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {p.volume} mentions · impact {p.impact > 0 ? "+" : ""}
                  {p.impact} · {p.aspect}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
