import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/nps-data";

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
  description?: string;
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
