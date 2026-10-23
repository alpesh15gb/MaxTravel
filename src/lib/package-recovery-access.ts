import { ApiError, jsonError } from "./guard";
import { salesRecoveryContext } from "./sales-recovery-context";
import type { SessionUser } from "./session";
export const PACKAGE_NO_STORE = { "Cache-Control": "private, no-store" };
export function packageRecoveryError(error: unknown) {
  const response = jsonError(error); response.headers.set("Cache-Control", PACKAGE_NO_STORE["Cache-Control"]); return response;
}
/** Equality check only, never an authorization substitute. UI always supplies it. */
export function packageWriteBody(user: SessionUser, body: Record<string, unknown>) {
  if (Object.hasOwn(body, "expectedRecoveryContext") && (typeof body.expectedRecoveryContext !== "string" || body.expectedRecoveryContext !== salesRecoveryContext(user))) throw new ApiError(403, "Staff session or access changed. Reload the package workspace before continuing.");
  const { expectedRecoveryContext: _context, ...data } = body; void _context; return data;
}
