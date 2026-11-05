import assert from "node:assert/strict";
import { ROLE_ACCESS, ROLE_PERMISSIONS, type RoleKey } from "../src/lib/permissions";
import { canViewInternalFinance, canConfirmSupplierCost, canReadAccountReport } from "../src/lib/finance-policy";
import { assertStaffAccessChange, canManageStaffAccess } from "../src/lib/staff-access";

const viewer = (role: RoleKey) => ({ role, permissions: ROLE_PERMISSIONS[role] });
for (const role of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
  assert.equal(canViewInternalFinance(viewer(role)), ["SUPER_ADMIN", "OWNER", "BRANCH_MANAGER", "ACCOUNTS"].includes(role), role);
  assert.equal(canConfirmSupplierCost(viewer(role)), ["SUPER_ADMIN", "OWNER", "BRANCH_MANAGER", "ACCOUNTS"].includes(role), role);
  assert.equal(canManageStaffAccess(viewer(role)), ["SUPER_ADMIN", "OWNER"].includes(role), role);
}
assert.equal(ROLE_ACCESS.READ_ONLY, "ASSIGNED");
for (const permission of ["payment:view", "finance:internal", "audit:view", "employee:view", "export:data", "work:team", "work:report"]) {
  assert(!ROLE_PERMISSIONS.READ_ONLY.some(value => value === permission));
}
assert(!ROLE_PERMISSIONS.HR.includes("customer:view"));
assert(!ROLE_PERMISSIONS.VISA_MANAGER.includes("export:data"));
assert(!ROLE_PERMISSIONS.TICKETING_MANAGER.includes("export:data"));
for (const report of ["statement", "ageing", "receipts"]) assert(canReadAccountReport(viewer("SALES_EXECUTIVE"), report));
for (const report of ["sales", "operations", "cancellations", "refunds", "supplier-payables", "supplier-statement"]) assert(!canReadAccountReport(viewer("SALES_EXECUTIVE"), report));
for (const role of ["VISA_EXECUTIVE", "TICKETING_EXECUTIVE", "TRAVEL_EXECUTIVE", "READ_ONLY", "HR"] as const) assert(!canReadAccountReport(viewer(role), "statement"));
const employee = { email: "staff@example.test", roleId: "role-staff", branchId: "branch-a", active: true };
const forbidden = [{}, { roleId: "role-reader" }, { branchId: "branch-b" }, { email: "changed@example.test" }, { active: false }, { password: "Synthetic-Password-2026!" }];
assert.throws(() => assertStaffAccessChange(viewer("HR"), null, {}), /create staff accounts/);
for (const change of forbidden.slice(1)) assert.throws(() => assertStaffAccessChange(viewer("HR"), employee, change), /Only an owner/);
assert.doesNotThrow(() => assertStaffAccessChange(viewer("HR"), employee, { ...employee, email: " STAFF@example.test ", name: "New name", salary: 12345, bankAccount: "Synthetic" }));
assert.doesNotThrow(() => assertStaffAccessChange(viewer("OWNER"), null, { roleId: "role-reader" }));
console.log("Staff access policy passed: private finance, assigned read-only, safe customer statements and owner-only access administration.");
