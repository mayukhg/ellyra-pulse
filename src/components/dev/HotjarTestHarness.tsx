import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Bug, ChevronDown, ChevronUp, EyeOff, Eye, LogOut, Send, UserCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  getHotjarConfig,
  getHotjarLog,
  getHotjarQueueStatus,
  identifyUser,
  resetHotjarUser,
  subscribeHotjarLog,
  trackHotjarEvent,
  type HotjarQueueStatus,
} from "@/lib/hotjar";
import {
  SYNTHETIC_MASKING_PAYLOADS,
  generateSyntheticHotjarUsers,
  toHotjarAttributes,
} from "@/test/fixtures/hotjarSyntheticData";

const DISPATCH_EVENTS = [
  "filter_applied",
  "telemetry_export_initiated",
  "error_boundary_tripped",
] as const;

const EMPTY_LOG: ReturnType<typeof getHotjarLog> = [];

function useHotjarLog() {
  return useSyncExternalStore(subscribeHotjarLog, getHotjarLog, () => EMPTY_LOG);
}

function useQueueStatus(active: boolean): HotjarQueueStatus {
  const [status, setStatus] = useState(getHotjarQueueStatus);
  useEffect(() => {
    if (!active) return;
    setStatus(getHotjarQueueStatus());
    const t = setInterval(() => setStatus(getHotjarQueueStatus()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return status;
}

export function HotjarTestHarness() {
  const [open, setOpen] = useState(false);
  const personas = useMemo(() => generateSyntheticHotjarUsers(12), []);
  const [personaId, setPersonaId] = useState(personas[0]?.userIdHash ?? "");
  const [identified, setIdentified] = useState<string | null>(null);
  const log = useHotjarLog();
  const status = useQueueStatus(open);
  const { siteId, debug } = getHotjarConfig();
  const persona = personas.find((p) => p.userIdHash === personaId);

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(26rem,calc(100vw-2rem))] text-xs">
      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 bg-foreground px-3 py-2 text-left font-semibold text-background"
        >
          <Bug className="size-3.5" />
          Hotjar QA harness
          <span
            className={cn(
              "ml-2 rounded px-1.5 py-0.5 font-mono text-[10px]",
              status.initialized ? "bg-promoter text-background" : "bg-passive text-background",
            )}
          >
            {status.initialized ? "LIVE" : siteId ? "PENDING" : "LOCAL ONLY"}
          </span>
          <span className="ml-auto">
            {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
        </button>

        {open && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-3">
            <section className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-2 font-mono text-[11px]">
              <span className="text-muted-foreground">site id</span>
              <span>{siteId ?? "unset"}</span>
              <span className="text-muted-foreground">debug</span>
              <span>{String(debug)}</span>
              <span className="text-muted-foreground">window.hj</span>
              <span>{status.hjPresent ? "present" : "missing"}</span>
              <span className="text-muted-foreground">window.hj.q</span>
              <span>
                {status.queueLength === null ? "— (no stub queue)" : `${status.queueLength} queued`}
              </span>
              <span className="text-muted-foreground">identified</span>
              <span className="truncate">{identified ?? "anonymous"}</span>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">User persona simulator</h3>
              <select
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]"
              >
                {personas.map((p) => (
                  <option key={p.userIdHash} value={p.userIdHash}>
                    {p.userIdHash.slice(0, 8)} · {p.account_tier} · {p.user_role} · {p.device}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  disabled={!persona}
                  onClick={() => {
                    if (!persona) return;
                    identifyUser(persona.userIdHash, toHotjarAttributes(persona));
                    setIdentified(persona.userIdHash.slice(0, 8));
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-clinical px-2 py-1.5 font-semibold text-clinical-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <UserCheck className="size-3.5" /> identifyUser()
                </button>
                <button
                  onClick={() => {
                    resetHotjarUser();
                    setIdentified(null);
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 font-medium hover:bg-accent"
                >
                  <LogOut className="size-3.5" /> resetHotjarUser()
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Event dispatcher</h3>
              <div className="flex flex-wrap gap-1.5">
                {DISPATCH_EVENTS.map((name) => (
                  <button
                    key={name}
                    onClick={() => trackHotjarEvent(name)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-clinical hover:bg-clinical/8"
                  >
                    <Send className="size-3" /> {name}
                  </button>
                ))}
              </div>
              <ol className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5 font-mono text-[10.5px]">
                {log.length === 0 && <li className="text-muted-foreground">No commands yet.</li>}
                {log.slice(0, 30).map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                    <span className={e.sent ? "text-promoter" : "text-passive"}>
                      {e.sent ? "sent" : "local"}
                    </span>
                    <span className="text-muted-foreground">{e.kind}</span>
                    <span className="truncate text-foreground">{e.name}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Privacy masking test zone</h3>
              <p className="text-muted-foreground">
                In a Hotjar recording the right column should render as redacted blocks.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1 rounded-md border border-promoter/40 bg-promoter/6 p-2">
                  <div className="flex items-center gap-1 font-semibold text-promoter">
                    <Eye className="size-3" /> Public
                  </div>
                  <div className="font-mono text-[10.5px]">tier: {persona?.account_tier}</div>
                  <div className="font-mono text-[10.5px]">role: {persona?.user_role}</div>
                  <div className="font-mono text-[10.5px]">device: {persona?.device}</div>
                </div>
                <div
                  data-hj-suppress
                  className="space-y-1 rounded-md border border-safety/40 bg-safety/6 p-2"
                >
                  <div className="flex items-center gap-1 font-semibold text-safety">
                    <EyeOff className="size-3" /> data-hj-suppress
                  </div>
                  <div className="break-all font-mono text-[10.5px]">
                    {persona?.maskedContext.apiKey ?? SYNTHETIC_MASKING_PAYLOADS.apiKey}
                  </div>
                  <div className="font-mono text-[10.5px]">
                    ip: {persona?.maskedContext.clientIp ?? SYNTHETIC_MASKING_PAYLOADS.clusterIp}
                  </div>
                  <div className="break-all font-mono text-[10.5px]">
                    {persona?.maskedContext.email ?? SYNTHETIC_MASKING_PAYLOADS.email}
                  </div>
                  <div className="break-all font-mono text-[10.5px]">
                    {SYNTHETIC_MASKING_PAYLOADS.databaseUrl}
                  </div>
                </div>
              </div>
            </section>

            <Link
              to="/dev/hotjar-insights"
              className="block rounded-md border border-border py-1.5 text-center font-medium hover:bg-accent"
            >
              Open Hotjar insights dashboard →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
