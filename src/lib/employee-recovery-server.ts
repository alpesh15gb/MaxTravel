import { createHash } from "node:crypto";
import type { SessionUser } from "./session";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Equality-only staff/session boundary. This is not an authorization capability. */
export function employeeRecoveryContext(user: Pick<SessionUser, "id" | "sessionId" | "branchId" | "accessMode" | "permissions" | "role" | "mfaEnabled">) {
  if (!user.sessionId) throw new Error("An authenticated staff session is required.");
  return hash(["employee-recovery-v1", user.sessionId, user.id, user.branchId, user.accessMode, user.role, [...user.permissions].sort(), !!user.mfaEnabled]);
}
/** Same visibility as the employee page, not the broader mutation permission. */
export function employeeReadScope(user: Pick<SessionUser, "id" | "branchId" | "accessMode">) {
  return user.accessMode === "BRANCH" ? { branchId: user.branchId } : user.accessMode === "ASSIGNED" ? { id: user.id } : {};
}
type RevisionEmployee = {
  id: string; name: string; email: string; phone: string; roleId: string; branchId: string | null;
  active: boolean; salary: number | null; bankAccount: string | null; passwordHash: string;
};
/** Includes credentials without exposing them; an old editor cannot overwrite a newer staff record. */
export function employeeRevision(employee: RevisionEmployee) {
  return hash(["employee-revision-v1", employee.id, employee.name, employee.email, employee.phone,
    employee.roleId, employee.branchId, employee.active, employee.salary, employee.bankAccount, employee.passwordHash]);
}
