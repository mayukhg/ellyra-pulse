import { Stethoscope, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { aspectRows, type Aspect } from "@/lib/nps-data";
import { MetricTooltip, SectionHeading } from "./shared";

export function AbsaExplorer({
  selected,
  onSelect,
}: {
  selected: Aspect | null;
  onSelect: (a: Aspect | null) => void;
}) {
  return (
    <Card className="gap-0 p-5">
      <SectionHeading
        title="Aspect-based sentiment (ABSA) explorer"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              Aspect mentions
              <MetricTooltip label="Aspect mentions">
                Number of feedback responses tagged with the aspect. One response may contribute to
                more than one aspect.
              </MetricTooltip>
            </span>
            <span className="inline-flex items-center gap-1">
              polarity split
              <MetricTooltip label="Aspect polarity split">
                Positive and negative shares among classified mentions for that aspect. The bars
                show direction, while the mention count shows scale.
              </MetricTooltip>
            </span>
          </span>
        }
        right={
          selected && (
            <button
              onClick={() => onSelect(null)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Clear aspect filter
            </button>
          )
        }
      />
      <div className="mt-4 space-y-2">
        {aspectRows.map((a) => (
          <button
            key={a.aspect}
            onClick={() => onSelect(selected === a.aspect ? null : a.aspect)}
            className={cn(
              "w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent/60",
              selected === a.aspect && "border-clinical bg-clinical/8",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {a.clinical ? (
                  <Stethoscope className="size-4 text-clinical" />
                ) : (
                  <Wrench className="size-4 text-muted-foreground" />
                )}
                {a.aspect}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {a.mentions.toLocaleString()} mentions
              </span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="bg-promoter" style={{ width: `${a.positive}%` }} />
              <div className="bg-detractor" style={{ width: `${a.negative}%` }} />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[11px]">
              <span className="text-promoter">{a.positive}% positive</span>
              <span className="text-detractor">{a.negative}% negative</span>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}
