import { createHash } from "node:crypto";
import type { SessionUser } from "./session";

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Equality-only recovery namespace, NOT authentication or an authorization capability. */
export function salesRecoveryContext(user: Pick<SessionUser, "sessionId" | "id" | "branchId" | "accessMode" | "permissions">) {
  if (!user.sessionId) throw new Error("An authenticated session is required for sales recovery.");
  return fingerprint(["sales-recovery-context-v1", user.sessionId, user.id, user.branchId ?? null,
    user.accessMode, [...user.permissions].sort()]);
}

type RevisionLead = {
  id: string; customerId: string; branchId: string; ownerId: string; stage: string; updatedAt: Date;
};
type RevisionQuote = {
  id: string; version: number; state: string; bookingId: string | null;
  acceptedAt: Date | null; expiresAt: Date;
};
/** All versions matter: accepting or withdrawing an older proposal must invalidate a draft base. */
export function salesBaseRevision(lead: RevisionLead, quotes: readonly RevisionQuote[]) {
  return fingerprint(["sales-quote-base-v1", lead.id, lead.customerId, lead.branchId, lead.ownerId,
    lead.stage, lead.updatedAt.toISOString(), [...quotes].sort((a, b) => a.id.localeCompare(b.id)).map(quote =>
      [quote.id, quote.version, quote.state, quote.bookingId, quote.acceptedAt?.toISOString() ?? null, quote.expiresAt.toISOString()])]);
}
