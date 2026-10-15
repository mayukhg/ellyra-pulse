/**
 * Fire-and-forget server-side Mixpanel track via the HTTP /track endpoint.
 * Uses the project token (never the service-account secret) and never sends PHI.
 */
import type { MixpanelEventMap, MixpanelEventName } from "@/lib/mixpanel-events";
import { sanitizeMixpanelProperties } from "@/lib/mixpanel-sanitize";

function projectToken(): string | null {
  const token = (
    process.env["NEXT_PUBLIC_MIXPANEL_TOKEN"] ||
    process.env["VITE_MIXPANEL_TOKEN"] ||
    ""
  ).trim();
  return token.length > 0 ? token : null;
}

function apiHost(): string {
  return process.env["MIXPANEL_EU_RESIDENCY"] === "true"
    ? "https://api-eu.mixpanel.com"
    : "https://api.mixpanel.com";
}

export function trackServerEvent<E extends MixpanelEventName>(
  event: E,
  properties: MixpanelEventMap[E],
  distinctId = "system",
): void {
  const token = projectToken();
  if (!token) return;

  const safe = sanitizeMixpanelProperties(properties as Record<string, unknown>);
  const payload = [
    {
      event,
      properties: {
        ...safe,
        token,
        distinct_id: distinctId,
        time: Math.floor(Date.now() / 1000),
        ip: 0,
      },
    },
  ];

  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  void fetch(`${apiHost()}/track?ip=0`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
    body: `data=${encodeURIComponent(body)}`,
  }).catch((err: unknown) => {
    console.error(
      `[mixpanel] track failed for ${event}:`,
      err instanceof Error ? err.message : "unknown",
    );
  });
}

export function sentimentCategoryForScore(score: number): MixpanelEventMap["sentiment_record_created"]["sentiment_category"] {
  if (score <= 3) return "critical";
  if (score <= 6) return "negative";
  if (score <= 8) return "neutral";
  return "positive";
}

export function severityFromReasonCodes(
  reasonCodes: string[],
): MixpanelEventMap["adverse_event_detected"]["severity"] {
  const joined = reasonCodes.join(" ").toLowerCase();
  if (joined.includes("critical") || joined.includes("self_harm") || joined.includes("emergency")) {
    return "critical";
  }
  if (joined.includes("high") || joined.includes("urgent")) return "high";
  if (joined.includes("medium") || reasonCodes.length > 1) return "medium";
  return "low";
}
