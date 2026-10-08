import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

// Inlined (not imported) so the bundler constant-folds it: in production builds without
// VITE_ENABLE_HOTJAR_DEBUG=true the route 404s and the dashboard chunk is never emitted.
export const Route = createFileRoute("/dev/hotjar-insights")({
  beforeLoad: () => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_ENABLE_HOTJAR_DEBUG === "true")) {
      throw notFound();
    }
  },
  head: () => ({
    meta: [
      { title: "Hotjar Behavioral Insights · Dev" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component:
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_HOTJAR_DEBUG === "true"
      ? lazyRouteComponent(
          () => import("@/components/analytics/HotjarMetricsDashboard"),
          "HotjarMetricsDashboard",
        )
      : () => null,
});
