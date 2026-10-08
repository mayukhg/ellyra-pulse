import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { initHotjar, trackHotjarStateChange } from "@/lib/hotjar";
import { initMixpanel, trackMixpanelEvent } from "@/lib/mixpanel";

// Inlined (not imported from lib/hotjar) so the bundler constant-folds it and drops the
// harness chunk entirely from production builds.
const HotjarTestHarness =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_HOTJAR_DEBUG === "true"
    ? lazy(() =>
        import("@/components/dev/HotjarTestHarness").then((m) => ({
          default: m.HotjarTestHarness,
        })),
      )
    : null;

function shouldShowHarness() {
  if (import.meta.env.DEV) return true;
  return new URLSearchParams(window.location.search).get("debug") === "hotjar";
}

export function HotjarProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lastPath = useRef<string | null>(null);
  const [showHarness, setShowHarness] = useState(false);

  useEffect(() => {
    initHotjar();
    initMixpanel();
    if (HotjarTestHarness) setShowHarness(shouldShowHarness());
  }, []);

  useEffect(() => {
    // Hotjar records the initial page itself; only report subsequent client-side navigations.
    if (lastPath.current !== null && lastPath.current !== pathname) {
      trackHotjarStateChange(pathname);
    }
    if (lastPath.current !== pathname) {
      trackMixpanelEvent("page_viewed", { path: pathname });
    }
    lastPath.current = pathname;
  }, [pathname]);

  return (
    <>
      {children}
      {HotjarTestHarness && showHarness && (
        <Suspense fallback={null}>
          <HotjarTestHarness />
        </Suspense>
      )}
    </>
  );
}
