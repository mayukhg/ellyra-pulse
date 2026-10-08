import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Filter,
  MousePointerClick,
  RotateCcw,
  Target,
  Users,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Chip, SectionHeading } from "@/components/nps/shared";
import { cn } from "@/lib/utils";
import { getHotjarLog, subscribeHotjarLog } from "@/lib/hotjar";
import {
  ACCOUNT_TIERS,
  DEVICE_TYPES,
  HOTJAR_FUNNEL_STEPS,
  USER_ROLES,
  buildSessionTimeline,
  generateSyntheticHotjarUsers,
  type FunnelStepKey,
  type SyntheticHotjarUser,
  type TimelineEntry,
} from "@/test/fixtures/hotjarSyntheticData";
import {
  DEFAULT_COHORT_FILTERS,
  applyCohortFilters,
  computeClickDistribution,
  computeFunnel,
  computeKpis,
  formatDuration,
  frustrationBadges,
  usersDroppedAt,
  type CohortFilters,
  type FrustrationBadge,
} from "./hotjarMetrics";

const SAMPLE_SIZES = [50, 250, 1000] as const;
const EMPTY_LOG: ReturnType<typeof getHotjarLog> = [];

const badgeTone: Record<FrustrationBadge, "safety" | "warn" | "neutral"> = {
  "Rage Click": "safety",
  "Console Error": "safety",
  "Dead Click": "warn",
  "U-Turn": "neutral",
};

export function HotjarMetricsDashboard() {
  const [sampleSize, setSampleSize] = useState<number>(250);
  const [filters, setFilters] = useState<CohortFilters>(DEFAULT_COHORT_FILTERS);
  const [dropOffStep, setDropOffStep] = useState<FunnelStepKey | null>(null);
  const [openSession, setOpenSession] = useState<SyntheticHotjarUser | null>(null);
  const localLog = useSyncExternalStore(subscribeHotjarLog, getHotjarLog, () => EMPTY_LOG);

  const allUsers = useMemo(() => generateSyntheticHotjarUsers(sampleSize), [sampleSize]);
  const cohort = useMemo(() => applyCohortFilters(allUsers, filters), [allUsers, filters]);
  const kpis = useMemo(() => computeKpis(cohort), [cohort]);
  const funnel = useMemo(() => computeFunnel(cohort), [cohort]);
  const clicks = useMemo(() => computeClickDistribution(cohort).slice(0, 10), [cohort]);
  const tableRows = useMemo(
    () => (dropOffStep ? usersDroppedAt(cohort, dropOffStep) : cohort),
    [cohort, dropOffStep],
  );

  const setFilter = <K extends keyof CohortFilters>(key: K, value: CohortFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const filtersActive =
    JSON.stringify(filters) !== JSON.stringify(DEFAULT_COHORT_FILTERS) || dropOffStep !== null;
  const dropOffLabel = HOTJAR_FUNNEL_STEPS.find((s) => s.key === dropOffStep)?.label;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-6 py-4">
          <span className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background">
            <Activity className="size-5" />
          </span>
          <div>
            <div className="text-sm font-semibold tracking-tight text-foreground">
              Hotjar Behavioral Insights
            </div>
            <div className="text-xs text-muted-foreground">
              Internal UX telemetry · synthetic fixtures + local events
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Chip tone="warn">DEV ONLY · synthetic data</Chip>
            <Link
              to="/"
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              ← Back to NPS tracker
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        <CohortFilterBar
          filters={filters}
          setFilter={setFilter}
          sampleSize={sampleSize}
          setSampleSize={setSampleSize}
          active={filtersActive}
          onReset={() => {
            setFilters(DEFAULT_COHORT_FILTERS);
            setDropOffStep(null);
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Users}
            label="Total analyzed sessions"
            value={kpis.sessions.toLocaleString()}
            hint={`of ${allUsers.length.toLocaleString()} generated`}
          />
          <KpiCard
            icon={Clock}
            label="Avg. session duration"
            value={formatDuration(kpis.avgDurationSec)}
            hint="mm:ss"
          />
          <KpiCard
            icon={Target}
            label="Global funnel conversion"
            value={`${kpis.conversionPct.toFixed(1)}%`}
            hint="session start → telemetry exported"
          />
          <KpiCard
            icon={AlertTriangle}
            label="Frustration index"
            value={`${kpis.frustrationIndexPct.toFixed(1)}%`}
            hint="sessions with rage clicks or UI errors"
            tone={kpis.frustrationIndexPct >= 25 ? "safety" : "default"}
          />
        </div>

        <Card className="gap-0 p-5">
          <SectionHeading
            title="Funnel conversion & drop-off"
            description="Click a drop-off to filter the session table to the users who abandoned at that step."
          />
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {funnel.map((step, i) => (
              <div key={step.key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-foreground">
                    {i + 1}. {step.label}
                  </span>
                  <span className="font-mono text-muted-foreground">{step.reached}</span>
                </div>
                <div className="relative h-28 overflow-hidden rounded-lg bg-muted">
                  <div
                    className="absolute inset-x-0 bottom-0 bg-clinical/80 transition-all"
                    style={{ height: `${step.overallPct}%` }}
                  />
                  <span className="absolute left-2 top-2 font-mono text-sm font-semibold text-foreground">
                    {step.overallPct.toFixed(1)}%
                  </span>
                </div>
                {i === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
                    Entry step
                  </div>
                ) : (
                  <button
                    onClick={() => setDropOffStep(dropOffStep === step.key ? null : step.key)}
                    disabled={step.dropOff === 0}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors disabled:opacity-50",
                      dropOffStep === step.key
                        ? "border-safety bg-safety/12 text-safety"
                        : "border-border hover:border-safety/50 hover:bg-safety/6",
                    )}
                  >
                    <span className="font-semibold">−{step.dropOff} dropped</span>
                    <span className="ml-1 text-muted-foreground">
                      · {step.stepConversionPct.toFixed(1)}% step conversion
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="gap-0 p-5">
            <SectionHeading
              title="Session replay simulator"
              description={`${tableRows.length} session${tableRows.length === 1 ? "" : "s"} · click a row for its event timeline`}
              right={
                dropOffLabel && (
                  <button
                    onClick={() => setDropOffStep(null)}
                    className="inline-flex items-center gap-1 rounded-md border border-safety/40 bg-safety/8 px-2 py-1 text-[11px] font-medium text-safety"
                  >
                    Dropped before “{dropOffLabel}” <X className="size-3" />
                  </button>
                )
              }
            />
            <SessionTable rows={tableRows} onOpen={setOpenSession} />
          </Card>

          <div className="space-y-6">
            <ClickDistribution rows={clicks} />
            <Card className="gap-0 p-5">
              <SectionHeading
                title="Local event stream"
                description="Commands sent through src/lib/hotjar.ts in this browser tab"
              />
              <ol className="mt-3 max-h-56 space-y-1 overflow-y-auto font-mono text-[11px]">
                {localLog.length === 0 && (
                  <li className="text-muted-foreground">
                    No local events yet — use the QA harness or the NPS tracker.
                  </li>
                )}
                {localLog.slice(0, 50).map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                    <span className={e.sent ? "text-promoter" : "text-passive"}>
                      {e.sent ? "sent" : "local"}
                    </span>
                    <span className="truncate">
                      {e.kind}: {e.name}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      </main>

      <SessionSheet session={openSession} onClose={() => setOpenSession(null)} />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "safety";
}) {
  return (
    <Card
      className={cn("flex flex-col gap-1 p-5", tone === "safety" && "border-safety/40 bg-safety/4")}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={cn("size-4", tone === "safety" ? "text-safety" : "text-clinical")} />
        {label}
      </div>
      <div className="font-mono text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </Card>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium capitalize text-foreground"
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

function CohortFilterBar({
  filters,
  setFilter,
  sampleSize,
  setSampleSize,
  active,
  onReset,
}: {
  filters: CohortFilters;
  setFilter: <K extends keyof CohortFilters>(key: K, value: CohortFilters[K]) => void;
  sampleSize: number;
  setSampleSize: (n: number) => void;
  active: boolean;
  onReset: () => void;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Filter className="size-3.5" /> Cohort
      </span>
      <FilterSelect
        label="Account tier"
        value={filters.tier}
        options={["all", ...ACCOUNT_TIERS]}
        onChange={(v) => setFilter("tier", v)}
      />
      <FilterSelect
        label="Role"
        value={filters.role}
        options={["all", ...USER_ROLES]}
        onChange={(v) => setFilter("role", v)}
      />
      <FilterSelect
        label="Device"
        value={filters.device}
        options={["all", ...DEVICE_TYPES]}
        onChange={(v) => setFilter("device", v)}
      />
      <FilterSelect
        label="Has frustration signals"
        value={filters.frustration}
        options={["all", "yes", "no"] as const}
        onChange={(v) => setFilter("frustration", v)}
      />
      <div className="ml-auto flex items-center gap-2">
        <FilterSelect
          label="Sample size"
          value={String(sampleSize)}
          options={SAMPLE_SIZES.map(String)}
          onChange={(v) => setSampleSize(Number(v))}
        />
        {active && (
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RotateCcw className="size-3" /> Reset
          </button>
        )}
      </div>
    </Card>
  );
}

function SessionTable({
  rows,
  onOpen,
}: {
  rows: readonly SyntheticHotjarUser[];
  onOpen: (u: SyntheticHotjarUser) => void;
}) {
  return (
    <div className="mt-4 max-h-[560px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            {["User hash", "Tier", "Role", "Duration", "Events", "Frustration"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const badges = frustrationBadges(u);
            return (
              <tr
                key={u.userIdHash}
                onClick={() => onOpen(u)}
                className="cursor-pointer border-t border-border hover:bg-clinical/4"
              >
                <td className="px-3 py-2 font-mono">{u.userIdHash.slice(0, 13)}…</td>
                <td className="px-3 py-2 capitalize">{u.account_tier}</td>
                <td className="px-3 py-2 capitalize">{u.user_role}</td>
                <td className="px-3 py-2 font-mono">{formatDuration(u.sessionDurationSec)}</td>
                <td className="px-3 py-2 font-mono">{u.events.length + u.interactions.length}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {badges.length === 0 && <span className="text-muted-foreground">—</span>}
                    {badges.map((b) => (
                      <Chip key={b} tone={badgeTone[b]}>
                        {b}
                      </Chip>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                No sessions match this cohort.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ClickDistribution({ rows }: { rows: ReturnType<typeof computeClickDistribution> }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card className="gap-0 p-5">
      <SectionHeading
        title="Click & dead click distribution"
        description="Top interaction targets · amber ≥ 15% dead, red ≥ 30% dead"
      />
      <ul className="mt-4 space-y-2.5">
        {rows.map((r) => {
          const severity = r.deadRatePct >= 30 ? "red" : r.deadRatePct >= 15 ? "amber" : "ok";
          return (
            <li key={r.target} className="space-y-1">
              <div className="flex items-center gap-2 text-[11px]">
                <MousePointerClick
                  className={cn(
                    "size-3",
                    severity === "red"
                      ? "text-safety"
                      : severity === "amber"
                        ? "text-passive"
                        : "text-muted-foreground",
                  )}
                />
                <span className="font-mono text-foreground">{r.target}</span>
                <span className="ml-auto font-mono text-muted-foreground">
                  {r.total} · {r.deadRatePct.toFixed(0)}% dead
                  {r.rageClicks > 0 && ` · ${r.rageClicks} rage`}
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div className="bg-clinical/70" style={{ width: `${(r.clicks / max) * 100}%` }} />
                <div
                  className={severity === "red" ? "bg-safety" : "bg-passive"}
                  style={{ width: `${(r.deadClicks / max) * 100}%` }}
                />
                <div className="bg-detractor" style={{ width: `${(r.rageClicks / max) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
        <Legend className="bg-clinical/70" label="Click" />
        <Legend className="bg-passive" label="Dead click" />
        <Legend className="bg-detractor" label="Rage click" />
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("size-2 rounded-full", className)} /> {label}
    </span>
  );
}

const lifecycleLabel: Record<string, string> = {
  session_authenticated: "Session authenticated",
  dashboard_viewed: "Dashboard viewed",
  filter_applied: "Filter applied",
  export_initiated: "Export initiated",
  export_completed: "Export completed",
  export_failed: "Export failed",
};

function timelineStyle(e: TimelineEntry) {
  if (e.type === "lifecycle") {
    return e.name === "export_failed"
      ? { dot: "bg-safety", label: lifecycleLabel[e.name] ?? e.name, strong: true }
      : { dot: "bg-clinical", label: lifecycleLabel[e.name] ?? e.name, strong: true };
  }
  const map = {
    click: { dot: "bg-muted-foreground/40", label: "Click" },
    dead_click: { dot: "bg-passive", label: "Dead click" },
    rage_click: { dot: "bg-detractor", label: "Rage click" },
    u_turn: { dot: "bg-passive", label: "U-turn" },
    js_error: { dot: "bg-safety", label: "Console error" },
  } as const;
  return { ...map[e.kind], strong: e.kind !== "click" };
}

function SessionSheet({
  session,
  onClose,
}: {
  session: SyntheticHotjarUser | null;
  onClose: () => void;
}) {
  const timeline = useMemo(() => (session ? buildSessionTimeline(session) : []), [session]);
  return (
    <Sheet open={!!session} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {session && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm">{session.userIdHash}</SheetTitle>
              <SheetDescription>
                {session.account_tier} · {session.user_role} · {session.device} ·{" "}
                {formatDuration(session.sessionDurationSec)} ·{" "}
                {new Date(session.startedAt).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap gap-1">
              {frustrationBadges(session).map((b) => (
                <Chip key={b} tone={badgeTone[b]}>
                  {b}
                </Chip>
              ))}
            </div>

            <div
              data-hj-suppress
              className="mt-4 space-y-1 rounded-lg border border-safety/30 bg-safety/4 p-3 font-mono text-[11px]"
            >
              <div className="mb-1 font-sans text-xs font-semibold text-safety">
                Session context (data-hj-suppress)
              </div>
              <div>ip: {session.maskedContext.clientIp}</div>
              <div className="break-all">key: {session.maskedContext.apiKey}</div>
              <div>email: {session.maskedContext.email}</div>
            </div>

            <h3 className="mt-5 text-sm font-semibold text-foreground">Event timeline</h3>
            <ol className="mt-3 space-y-0 border-l border-border pl-4">
              {timeline.map((e, i) => {
                const s = timelineStyle(e);
                return (
                  <li key={i} className="relative pb-3">
                    <span
                      className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full", s.dot)}
                    />
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="w-10 shrink-0 font-mono text-muted-foreground">
                        {formatDuration(e.atSec)}
                      </span>
                      <span
                        className={cn(
                          s.strong ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </span>
                      {e.type === "interaction" && (
                        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                          {e.target}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
