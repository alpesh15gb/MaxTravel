/** Client-safe outcome rules. No passwords, session tokens or HR drafts are stored here. */
export type EmployeeRecord = {
  id: string; employeeCode: string; name: string; email: string; phone: string;
  roleId: string; role: string; branchId: string | null; branch: string; active: boolean;
  salary: number | null; bankAccount: string | null; hrVisible: boolean; revision: string;
};
export type EmployeeAttempt = {
  id?: string; name: string; email?: string; passwordIncluded: boolean;
  /** A validated write acknowledgement is durable evidence, even if a later read fails. */
  acknowledgedId?: string;
  desired: Partial<Pick<EmployeeRecord, "name" | "email" | "phone" | "roleId" | "branchId" | "active" | "salary" | "bankAccount">>;
};
export function acknowledgeEmployeeAttempt(attempt: EmployeeAttempt, employeeId: string): EmployeeAttempt {
  return { ...attempt, id: employeeId, acknowledgedId: employeeId };
}
export function employeeRetryAllowed(attempt: EmployeeAttempt, current: EmployeeRecord | null | undefined, editing: boolean) {
  if (editing) return !!current && !attempt.passwordIncluded && !employeeMatches(attempt, current);
  // Even without an acknowledgement, a committed employee may have been renamed, deleted,
  // or moved outside scope. A negative email search cannot safely authorize creation replay.
  // Only a definite rejected write clears the action for correction and another submission.
  return false;
}
export function isEmployeeRecord(value: unknown): value is EmployeeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["id", "employeeCode", "name", "email", "phone", "roleId", "role", "branch", "revision"].every(key => typeof record[key] === "string") &&
    !!record.id && /^[a-f0-9]{64}$/.test(String(record.revision)) &&
    (record.branchId === null || typeof record.branchId === "string") && typeof record.active === "boolean" &&
    typeof record.hrVisible === "boolean" && (record.salary === null || (typeof record.salary === "number" && Number.isFinite(record.salary))) &&
    (record.bankAccount === null || typeof record.bankAccount === "string") &&
    (record.hrVisible || (record.salary === null && record.bankAccount === null));
}
export function employeeOutcome(status: number, data: unknown, context: string, id?: string): "acknowledged" | "rejected" | "uncertain" {
  if (!data || typeof data !== "object") return "uncertain";
  const result = data as Record<string, unknown>;
  if (status >= 200 && status < 300 && result.ok === true && result.recoveryContext === context &&
      typeof result.employeeId === "string" && result.employeeId.length > 0 && (!id || result.employeeId === id)) return "acknowledged";
  // Only the application's explicit pre-commit/rolled-back rejection is proof of no write.
  if (status >= 400 && status < 500 && result.employeeWrite === "rejected" && typeof result.error === "string") return "rejected";
  return "uncertain";
}
export function employeeMatches(attempt: EmployeeAttempt, current: EmployeeRecord | null) {
  if (!current || (attempt.id && attempt.id !== current.id)) return false;
  return Object.entries(attempt.desired).every(([key, value]) => current[key as keyof EmployeeRecord] === value);
}
/** Synchronous lock and generation guard: React's next render is too late for a duplicate event. */
export function createEmployeeOperationGuard() {
  let generation = 0;
  let pending = false;
  return {
    begin() { if (pending) return null; pending = true; return ++generation; },
    current(token: number) { return pending && token === generation; },
    finish(token: number) { if (token !== generation) return false; pending = false; return true; },
    invalidate() { generation += 1; pending = false; },
  };
}
