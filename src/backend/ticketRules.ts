/**
 * Ticket state-machine rules (§5.8) — shared by every repository implementation so the
 * transition logic can't drift between memory.ts and postgres.ts.
 */
import type { TicketStatus } from "./contracts";

export const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["contacted", "escalated"],
  contacted: ["resolved", "escalated"],
  escalated: ["contacted", "resolved"],
  resolved: [], // reopening resolved requires elevated permission — checked by the caller
};

export function isAllowedTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
