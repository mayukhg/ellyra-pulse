import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, FlaskConical, HeartPulse, LayoutDashboard, MessagesSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Scorecard } from "@/components/nps/Scorecard";
import { FeatureTable } from "@/components/nps/FeatureTable";
import { QuadrantScatter } from "@/components/nps/QuadrantScatter";
import { AbsaExplorer } from "@/components/nps/AbsaExplorer";
import { VerbatimHub } from "@/components/nps/VerbatimHub";
import { Simulator } from "@/components/nps/Simulator";
import { Chip } from "@/components/nps/shared";
import type { Aspect, Feature, QuadrantPoint } from "@/lib/nps-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ellyra Health — NPS Tracker & Sentiment Intelligence" },
      {
        name: "description",
        content:
          "Medical AI NPS command centre: trust KPIs, aspect sentiment, safety escalation and closed-loop patient feedback operations.",
      },
      { property: "og:title", content: "Ellyra Health — NPS & Sentiment Intelligence" },
      {
        property: "og:description",
        content:
          "Track anxiety reduction, clinical comprehension, hallucination flags and closed-loop patient feedback routing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [feature, setFeature] = useState<Feature | null>(null);
  const [aspect, setAspect] = useState<Aspect | null>(null);
  const [theme, setTheme] = useState<QuadrantPoint | null>(null);
  const [tab, setTab] = useState("scorecard");

  const selectTheme = (p: QuadrantPoint | null) => {
    setTheme(p);
    if (p) setTab("verbatims");
  };

  return (
    <TooltipProvider delayDuration={250}>
    <div className="min-h-screen bg-canvas">
      <Toaster position="top-right" />
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-clinical text-clinical-foreground">
              <HeartPulse className="size-5" />
            </span>
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground">
                Ellyra Health
              </div>
              <div className="text-xs text-muted-foreground">
                Customer NPS Tracker & Sentiment Intelligence
              </div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Chip tone="clinical">Q3 2026 · rolling 30 days</Chip>
            <Chip tone="neutral">PHI redaction: enforced</Chip>
            <Chip tone="safety">3 open P0 safety escalations</Chip>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {(feature || aspect || theme) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-clinical/25 bg-clinical/6 px-3 py-2 text-xs">
            <span className="font-medium text-clinical">Active filters:</span>
            {feature && <Chip tone="clinical">{feature}</Chip>}
            {aspect && <Chip tone="clinical">{aspect}</Chip>}
            {theme && <Chip tone="safety">{theme.theme}</Chip>}
            <button
              onClick={() => {
                setFeature(null);
                setAspect(null);
                setTheme(null);
              }}
              className="ml-auto rounded-md border border-border bg-background px-2 py-1 font-medium hover:bg-accent"
            >
              Reset all
            </button>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5 h-auto flex-wrap gap-1 bg-muted/60 p-1">
            <TabsTrigger value="scorecard" className="gap-1.5 px-3 py-2 text-sm">
              <LayoutDashboard className="size-4" /> Executive scorecard
            </TabsTrigger>
            <TabsTrigger value="rootcause" className="gap-1.5 px-3 py-2 text-sm">
              <Activity className="size-4" /> Root cause & ABSA
            </TabsTrigger>
            <TabsTrigger value="verbatims" className="gap-1.5 px-3 py-2 text-sm">
              <MessagesSquare className="size-4" /> Verbatims & closed loop
            </TabsTrigger>
            <TabsTrigger value="simulator" className="gap-1.5 px-3 py-2 text-sm">
              <FlaskConical className="size-4" /> Workflow simulator
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scorecard" className="space-y-6">
            <Scorecard />
            <FeatureTable selected={feature} onSelect={setFeature} />
          </TabsContent>

          <TabsContent value="rootcause" className="space-y-6">
            <QuadrantScatter featureFilter={feature} selected={theme} onSelect={selectTheme} />
            <AbsaExplorer selected={aspect} onSelect={setAspect} />
          </TabsContent>

          <TabsContent value="verbatims">
            <VerbatimHub
              featureFilter={feature}
              onFeatureFilter={(f) => {
                setTheme(null);
                setFeature(f);
              }}
              aspectFilter={aspect}
              onAspectFilter={(a) => {
                setTheme(null);
                setAspect(a);
              }}
              themeFilter={theme}
            />
          </TabsContent>

          <TabsContent value="simulator">
            <Simulator />
          </TabsContent>
        </Tabs>
      </main>
    </div>
    </TooltipProvider>
  );
}
