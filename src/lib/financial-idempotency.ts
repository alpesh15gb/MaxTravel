import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ApiError } from "./guard";

type Tx = Prisma.TransactionClient;
export function financialRequestKey(value: unknown): string | null {
  if (value === undefined || value === null) return null; // Older API callers remain supported.
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new ApiError(400, "Invalid financial request key. Reopen the form before submitting.");
  return value;
}
export function financialRequestHash(normalized: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(normalized).sort(([a],[b])=>a.localeCompare(b))))).digest("hex");
}
/** Call only after rechecking current customer and linked-record access. */
export async function replayFinancialRequest(tx: Tx, actorId: string, operation: string, requestKey: string | null, requestHash: string) {
  if (!requestKey) return null;
  const saved = await tx.financialMutation.findUnique({ where: { actorId_operation_requestKey: { actorId, operation, requestKey } } });
  if (!saved) return null;
  if (saved.requestHash !== requestHash) throw new ApiError(409, "This request was already saved with different details. Check the saved record; use a new form only for a genuinely new transaction.");
  return JSON.parse(saved.responseJson) as Record<string, unknown>;
}
export async function rememberFinancialRequest(tx: Tx, actorId: string, operation: string, requestKey: string | null, requestHash: string, response: Record<string, unknown>) {
  if (requestKey) await tx.financialMutation.create({ data: { actorId, operation, requestKey, requestHash, responseJson: JSON.stringify(response) } });
}
export function financialConflict(error: unknown) {
  const code = (error as { code?: string })?.code;
  return ["P2002", "P2034", "P1008", "P2028"].includes(code ?? "")
    ? new ApiError(409, "Another financial save may have completed. Check the record, then retry the unchanged form with its original request key; do not create a second transaction.") : error;
}
