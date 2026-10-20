import type { SessionUser } from "./session";

/** Match the list scope: no unassigned branch leaks and either assignment grants access. */
export function canTouchRecord(
  user: SessionUser,
  record: { branchId?: string | null; ownerId?: string | null; assignedToId?: string | null },
): boolean {
  const mode = user.accessMode ?? "ASSIGNED";
  if (mode === "ALL") return true;
  if (mode === "BRANCH") return Boolean(user.branchId) && record.branchId === user.branchId;
  return record.ownerId === user.id || record.assignedToId === user.id;
}
