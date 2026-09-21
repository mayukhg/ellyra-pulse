/**
 * Cursor-paginated verbatim query backing §5.5. Cursor ordering is (received_at desc,
 * response_id desc), matching the real SQL index recommended in §3.1.
 */
import type { CursorPage, VerbatimListItem, VerbatimQuery } from "./contracts";
import { store, type NpsResponseRow } from "./store";
import { newRequestId } from "./http";

function encodeCursor(row: NpsResponseRow): string {
  return Buffer.from(`${row.receivedAt}|${row.responseId}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { receivedAt: string; responseId: string } | null {
  try {
    const [receivedAt, responseId] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!receivedAt || !responseId) return null;
    return { receivedAt, responseId };
  } catch {
    return null;
  }
}

function toListItem(row: NpsResponseRow): VerbatimListItem {
  const ticket = store.ticketByResponseId(row.responseId);
  const feature = store.featureTouchpoints.find(
    (f) => f.featureTouchpointId === row.featureTouchpointId,
  );

  return {
    id: row.responseId,
    receivedAt: row.receivedAt,
    score: row.npsScore,
    tier: row.npsTier,
    sentiment: row.sentimentScore ?? 0,
    feature: { key: feature?.featureKey ?? "unknown", name: feature?.featureName ?? "Unknown" },
    surveyType: row.surveyType,
    text: row.verbatimRedacted ?? "",
    redactions: row.redactionTags.map((tag) => ({
      tag,
      count: row.redactionCount, // per-tag counts would need the full redaction breakdown persisted
    })),
    aspects: row.aspects,
    safety: { flagged: row.safetyFlag, reasonCodes: row.safetyReasonCodes },
    routeAction: row.routeAction ?? "micro_poll",
    ticket: ticket
      ? {
          id: ticket.ticketId,
          status: ticket.status,
          slaDueAt: ticket.slaDueAt,
          breached: Boolean(ticket.slaBreachedAt),
        }
      : null,
    telemetry: {
      sessionRef: row.sessionRef,
      modelVersion: row.modelVersion,
      deviceFamily: null,
      channel: row.channel,
    },
  };
}

export function queryVerbatims(query: VerbatimQuery): CursorPage<VerbatimListItem> {
  let rows = store.responses.filter((r) => {
    const receivedAt = r.receivedAt.slice(0, 10);
    if (receivedAt < query.from || receivedAt >= query.to) return false;
    if (query.feature) {
      const feature = store.featureByKey(query.feature);
      if (feature?.featureTouchpointId !== r.featureTouchpointId) return false;
    }
    if (query.aspect && !r.aspects.some((a) => a.aspect === query.aspect)) return false;
    if (query.surveyType && r.surveyType !== query.surveyType) return false;
    if (query.safetyRisk !== undefined && r.safetyFlag !== query.safetyRisk) return false;
    if (query.polarity) {
      const sentiment = r.sentimentScore ?? 0;
      if (query.polarity === "positive" && sentiment <= 0) return false;
      if (query.polarity === "negative" && sentiment >= 0) return false;
      if (query.polarity === "neutral" && sentiment !== 0) return false;
    }
    if (query.search) {
      const needle = query.search.toLowerCase();
      if (!(r.verbatimRedacted ?? "").toLowerCase().includes(needle)) return false;
    }
    if (query.slaStatus) {
      const ticket = store.ticketByResponseId(r.responseId);
      if (ticket?.status !== query.slaStatus) return false;
    }
    return true;
  });

  rows = rows.sort((a, b) =>
    query.sort === "sla_due_asc"
      ? 0 // TODO: join ticket.sla_due_at once tickets are indexed by response for sorting
      : b.receivedAt.localeCompare(a.receivedAt) || b.responseId.localeCompare(a.responseId),
  );

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (decoded) {
      rows = rows.filter(
        (r) =>
          r.receivedAt < decoded.receivedAt ||
          (r.receivedAt === decoded.receivedAt && r.responseId < decoded.responseId),
      );
    }
  }

  const page = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;

  return {
    data: page.map(toListItem),
    // hasMore implies page.length === query.limit > 0, so this index is always in bounds.
    page: { nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null, hasMore },
    meta: { requestId: newRequestId(), generatedAt: new Date().toISOString() },
  };
}
