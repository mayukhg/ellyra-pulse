import { ArrowDownRight, ArrowUpRight, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { featureRows, type Feature } from "@/lib/nps-data";
import { MetricTooltip, SectionHeading } from "./shared";

const columnHelp = {
  Feature: "The Ellyra product touchpoint associated with the survey response.",
  NPS: "Feature-specific NPS: percentage of Promoters minus percentage of Detractors, from −100 to +100.",
  MoM: "Point change in feature NPS versus the preceding calendar month.",
  Responses: "Count of valid NPS responses attributed to this feature in the selected period.",
  Distribution: "Percent split of Promoters (9–10), Passives (7–8), and Detractors (0–6), shown in that order.",
  "Top driver": "The highest-impact recurring ABSA theme associated with this feature’s score.",
  "Safety flags": "Responses flagged for possible clinical mismatch, unsafe reassurance, OCR error, or other immediate safety review.",
} as const;

export function FeatureTable({
  selected,
  onSelect,
}: {
  selected: Feature | null;
  onSelect: (f: Feature | null) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-border p-5">
        <SectionHeading
          title="Feature-level transactional NPS"
          description="Click a row to filter the whole dashboard by feature"
          right={
            selected && (
              <button
                onClick={() => onSelect(null)}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
              >
                Clear filter
              </button>
            )
          }
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
               {Object.entries(columnHelp).map(([label, help]) => (
                 <th key={label} className="px-5 py-3 font-medium">
                   <span className="inline-flex items-center gap-1">
                     {label}
                     <MetricTooltip label={`${label} column`}>{help}</MetricTooltip>
                   </span>
                 </th>
               ))}
            </tr>
          </thead>
          <tbody>
            {featureRows.map((r) => {
              const active = selected === r.feature;
              return (
                <tr
                  key={r.feature}
                  onClick={() => onSelect(active ? null : r.feature)}
                  className={cn(
                    "cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-clinical/6",
                    active && "bg-clinical/10",
                  )}
                >
                  <td className="px-5 py-4 font-medium text-foreground">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-6 w-1 rounded-full",
                          active ? "bg-clinical" : "bg-transparent",
                        )}
                      />
                      {r.feature}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-base font-semibold text-foreground">
                    +{r.nps}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 text-xs font-medium",
                        r.delta >= 0 ? "text-promoter" : "text-detractor",
                      )}
                    >
                      {r.delta >= 0 ? (
                        <ArrowUpRight className="size-3.5" />
                      ) : (
                        <ArrowDownRight className="size-3.5" />
                      )}
                      {r.delta > 0 ? "+" : ""}
                      {r.delta}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-muted-foreground">
                    {r.responses.toLocaleString()}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex h-2 w-36 overflow-hidden rounded-full">
                      <div className="bg-promoter" style={{ width: `${r.promoters}%` }} />
                      <div className="bg-passive" style={{ width: `${r.passives}%` }} />
                      <div className="bg-detractor" style={{ width: `${r.detractors}%` }} />
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {r.promoters}/{r.passives}/{r.detractors}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{r.topDriver}</td>
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs",
                        r.safetyFlags > 10
                          ? "border-safety/35 bg-safety/10 text-safety"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      <ShieldAlert className="size-3.5" />
                      {r.safetyFlags}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
