import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageClinicalOnCall } from "../paging";

interface PagerPayload {
  routing_key?: string;
  event_action: string;
  dedup_key: string;
  payload: { custom_details: { responseId: string; reasonCodes: string[]; slaSeconds: number } };
}

describe("pageClinicalOnCall", () => {
  let server: Server;
  let received: PagerPayload[] = [];
  let url: string;

  beforeEach(async () => {
    received = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "accepted" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    url = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
  });

  afterEach(async () => {
    delete process.env["PAGER_WEBHOOK_URL"];
    delete process.env["PAGER_ROUTING_KEY"];
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers a page to the configured webhook with the expected payload shape", async () => {
    process.env["PAGER_WEBHOOK_URL"] = url;
    process.env["PAGER_ROUTING_KEY"] = "test-routing-key";

    const result = await pageClinicalOnCall({
      responseId: "resp-123",
      reasonCodes: ["self_harm_or_emergency"],
      slaSeconds: 900,
    });

    expect(result.delivered).toBe(true);
    expect(result.transport).toBe("webhook");
    expect(received).toHaveLength(1);
    const first = received[0]!;
    expect(first.routing_key).toBe("test-routing-key");
    expect(first.payload.custom_details.responseId).toBe("resp-123");
    expect(first.payload.custom_details.reasonCodes).toContain("self_harm_or_emergency");
  });

  it("falls back to console (not delivered) when no webhook is configured", async () => {
    delete process.env["PAGER_WEBHOOK_URL"];
    const result = await pageClinicalOnCall({
      responseId: "resp-456",
      reasonCodes: ["contradicts_clinician"],
      slaSeconds: 900,
    });
    expect(result.delivered).toBe(false);
    expect(result.transport).toBe("console");
  });

  it("reports non-delivery when the webhook responds with an error status", async () => {
    server.close();
    server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(500);
        res.end("boom");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    process.env["PAGER_WEBHOOK_URL"] =
      typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";

    const result = await pageClinicalOnCall({
      responseId: "resp-789",
      reasonCodes: ["missed_abnormal_marker"],
      slaSeconds: 900,
    });
    expect(result.delivered).toBe(false);
    expect(result.transport).toBe("webhook");
  });
});
