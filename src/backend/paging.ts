/**
 * Clinical on-call paging (§10.1: P0 acknowledgement target 15 minutes). Pluggable transport:
 * a generic webhook (works with PagerDuty's Events API v2, Opsgenie, or any HTTP-based pager
 * that accepts a JSON POST) when PAGER_WEBHOOK_URL is set, otherwise a console fallback so local
 * development and the validation suite still exercise this path without real paging
 * credentials.
 *
 * Real production wiring (Phase 3) means setting PAGER_WEBHOOK_URL (and, for PagerDuty
 * specifically, PAGER_ROUTING_KEY) to a real integration — this module's interface shouldn't
 * need to change.
 */
export interface PageClinicalOnCallInput {
  responseId: string;
  reasonCodes: string[];
  slaSeconds: number;
}

export interface PageResult {
  delivered: boolean;
  transport: "webhook" | "console";
  detail?: string;
}

export async function pageClinicalOnCall(input: PageClinicalOnCallInput): Promise<PageResult> {
  const webhookUrl = process.env["PAGER_WEBHOOK_URL"];

  if (!webhookUrl) {
    console.warn(
      `[paging] No PAGER_WEBHOOK_URL configured — logging P0 instead of paging. response=${input.responseId} reasons=${input.reasonCodes.join(",")}`,
    );
    return { delivered: false, transport: "console", detail: "PAGER_WEBHOOK_URL not set" };
  }

  const routingKey = process.env["PAGER_ROUTING_KEY"];
  const payload = {
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: `ellyra-pulse-p0-${input.responseId}`,
    payload: {
      summary: `Ellyra Pulse P0: clinical safety flag on response ${input.responseId}`,
      severity: "critical",
      source: "ellyra-pulse",
      custom_details: {
        responseId: input.responseId,
        reasonCodes: input.reasonCodes,
        slaSeconds: input.slaSeconds,
      },
    },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[paging] Webhook responded with ${response.status}: ${body}`);
      return { delivered: false, transport: "webhook", detail: `HTTP ${response.status}` };
    }
    return { delivered: true, transport: "webhook" };
  } catch (err) {
    console.error("[paging] Failed to deliver page:", err);
    return { delivered: false, transport: "webhook", detail: (err as Error).message };
  }
}
