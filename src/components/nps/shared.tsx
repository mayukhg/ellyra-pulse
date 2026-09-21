import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/nps-data";

export function MetricTooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 bg-popover text-popover-foreground shadow-md" sideOffset={6}>
        <p className="leading-relaxed">{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function TierPill({ tier, score }: { tier: Tier; score?: number }) {
  const styles: Record<Tier, string> = {
    promoter: "bg-promoter/12 text-promoter border-promoter/30",
    passive: "bg-passive/15 text-passive border-passive/35",
    detractor: "bg-detractor/12 text-detractor border-detractor/30",
  };
  const label = tier === "promoter" ? "Promoter" : tier === "passive" ? "Passive" : "Detractor";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[tier],
      )}
    >
      {score !== undefined && <span className="font-mono font-semibold">{score}</span>}
      {label}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "clinical" | "safety" | "warn" | "good";
  className?: string;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground border-border",
    clinical: "bg-clinical/10 text-clinical border-clinical/25",
    safety: "bg-safety/12 text-safety border-safety/35",
    warn: "bg-passive/15 text-passive border-passive/35",
    good: "bg-promoter/12 text-promoter border-promoter/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  title,
  description,
  right,
}: {
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {right}
    </div>
  );
}

export function redactText(text: string) {
  return text.split(/(\[REDACTED_[A-Z]+\])/g).map((part, i) =>
    part.startsWith("[REDACTED_") ? (
      <span
        key={i}
        className="mx-0.5 rounded bg-clinical/12 px-1 py-0.5 font-mono text-[11px] font-medium text-clinical"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
