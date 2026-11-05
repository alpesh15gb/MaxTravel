import type { SessionUser } from "./session";
import { ApiError } from "./guard";

type StaffAccessRecord = { email: string; roleId: string; branchId: string | null; active: boolean };

export const canManageStaffAccess = (user: Pick<SessionUser, "role">) => user.role === "OWNER" || user.role === "SUPER_ADMIN";

export function assertStaffAccessChange(user: Pick<SessionUser, "role">, existing: StaffAccessRecord | null, input: Record<string, unknown>) {
  if (canManageStaffAccess(user)) return;
  if (!existing) throw new ApiError(403, "Only an owner or super administrator can create staff accounts.");
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : input.email;
  const branchId = typeof input.branchId === "string" ? input.branchId.trim() || null : input.branchId;
  if ((input.roleId !== undefined && input.roleId !== existing.roleId)
    || (input.branchId !== undefined && branchId !== existing.branchId)
    || (input.email !== undefined && email !== existing.email)
    || (input.active !== undefined && input.active !== existing.active)
    || (input.password !== undefined && input.password !== "" && input.password !== null)) {
    throw new ApiError(403, "Only an owner or super administrator can change login email, role, branch, active status or password. HR can update profile and payroll details.");
  }
}
