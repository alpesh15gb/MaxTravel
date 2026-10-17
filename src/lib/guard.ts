import { getServerSession, type SessionUser } from "./session";
import { can, canAny, accessModeFor } from "./rbac";
import type { Permission } from "./permissions";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Throws ApiError if unauthenticated or lacking any of the permissions. */
export async function requireSession(permission?: Permission | Permission[]): Promise<SessionUser> {
  const user = await getServerSession();
  if (!user) throw new ApiError(401, "Not signed in");
  if(permission && process.env.CRM_REQUIRE_MFA==="true" && !user.mfaEnabled) { throw new ApiError(403,"Set up your authenticator from Account security before continuing."); }
  if (permission) {
    const list = Array.isArray(permission) ? permission : [permission];
    if (!canAny(user.permissions, list)) throw new ApiError(403, "You do not have permission for this action");
  }
  return user;
}

/** Server-component guard: redirects instead of throwing so users get a friendly landing. */
export async function requirePage(permission?: Permission | Permission[]): Promise<SessionUser> {
  const user = await getServerSession();
  if (!user) redirect("/login");

  if(permission && process.env.CRM_REQUIRE_MFA==="true" && !user.mfaEnabled)redirect("/account-security");
  if (permission) {
    const list = Array.isArray(permission) ? permission : [permission];
    if (!canAny(user.permissions, list)) redirect("/dashboard?denied=" + encodeURIComponent(String(list[0])));
  }
 return user;
}

/** Prisma WHERE fragment restricting records by role access mode. */
export function scopeWhere(
  user: SessionUser,
  branchId?: string | null,
  ownerId?: string | null,
  assignedToId?: string | null,
): Record<string, unknown> {
  const mode = user.accessMode ?? accessModeFor(user.role);
  if (mode === "ALL") return {};
  if (mode === "BRANCH") {
    if (!user.branchId) return { id: "__none__" };
    return { branchId: user.branchId };
  }
  // ASSIGNED — see only records owned/assigned to me
  const or: Record<string, unknown>[] = [];
  if (ownerId) or.push({ [ownerId]: user.id });
  if (assignedToId) or.push({ [assignedToId]: user.id });
  if (!or.length) return { id: "__none__" };
  return { OR: or };
}

/** Can this user act on a specific record's owner/branch? */
export function canTouchRecord(
  user: SessionUser,
  record: { branchId?: string | null; ownerId?: string | null; assignedToId?: string | null },
): boolean {
  const mode = user.accessMode ?? "ASSIGNED";
  if (mode === "ALL") return true;
  if (mode === "BRANCH") return !record.branchId || record.branchId === user.branchId;
  if (record.ownerId) return record.ownerId === user.id;
  if (record.assignedToId) return record.assignedToId === user.id;
  return false;
}

export function assertCan(user: SessionUser, p: Permission) {
  if (!can(user.permissions, p)) throw new ApiError(403, `Missing permission: ${p}`);
}

/**
 * A short reference stapled to an unexpected 500. Staff can quote it and an operator can grep the
 * server log for it, instead of the two of them guessing which failure in a busy log is the one.
 */
function errorReference() {
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

/**
 * The single place a route turns a thrown error into a response.
 *
 * Expected failures (ApiError) keep their own status and message. Anything else is an unexpected
 * fault: the stack stays in the server log next to its reference, and the client is told nothing
 * about internals. `context` is optional and only narrows the log line (for example a route name).
 */
export function jsonError(e: unknown, context?: string): Response {
  if (e instanceof ApiError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  const reference = errorReference();
  console.error(`[error ${reference}]${context ? ` (${context})` : ""}`, e);
  return Response.json(
    {
      error: `The operation could not be completed. Please retry or contact your administrator. Reference: ${reference}.`,
      reference,
    },
    { status: 500 },
  );
}
