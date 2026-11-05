import {canManageStaffAccess} from "@/lib/staff-access";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { ROLE_ACCESS, ROLE_PERMISSIONS, type RoleKey } from "@/lib/permissions";
import EmployeesClient from "./EmployeesClient";
import { employeeReadScope, employeeRecoveryContext, employeeRevision } from "@/lib/employee-recovery-server";
import { roleDescription } from "@/lib/role-description";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const user = await requirePage("employee:view");
  const [employees, roles, branches] = await Promise.all([
    prisma.user.findMany({
      where: employeeReadScope(user),
      include: {
        role: true, branch: true,
        tasks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } },
        visaCases: { where: { stage: { key: { notIn: ["CLOSED", "DELIVERED"] } } }, select: { id: true } },
        bookings: { where: { status: { notIn: ["CANCELLED", "VOID", "REFUNDED"] } }, select: { id: true } },
      },
      orderBy: { employeeCode: "asc" },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <EmployeesClient
      key={employeeRecoveryContext(user)}
      recoveryContext={employeeRecoveryContext(user)}
      employees={employees.map((e) => ({
        revision: employeeRevision(e), id: e.id, employeeCode: e.employeeCode, name: e.name, email: e.email, phone: e.phone,
        roleId: e.roleId, role: e.role.name, roleKey: e.role.key, branchId: e.branchId,
        branch: e.branch?.name ?? "—", active: e.active, joinedOn: e.joinedOn?.toISOString() ?? null,
        salary: can(user.permissions, "hr:view") ? e.salary : null,
        bankAccount: can(user.permissions, "hr:view") ? e.bankAccount : null,
        hrVisible: can(user.permissions, "hr:view"),
        workload: { tasks: e.tasks.length, visaCases: e.visaCases.length, bookings: e.bookings.length },
      }))}
      roles={roles.map((r) => ({ id: r.id, name: r.name, requiresBranch: ["ASSIGNED", "BRANCH"].includes(ROLE_ACCESS[r.key as RoleKey]), combinedServices: r.key === "TRAVEL_EXECUTIVE", description: roleDescription(r.key, ROLE_PERMISSIONS[r.key as RoleKey] ?? []) }))}
      defaultBranchId={user.branchId}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={can(user.permissions, "employee:manage")}
      // Resetting somebody's password hands over their whole account, so the route only allows it for
      // an owner or super administrator. The form offers nothing else, rather than offering it and
      // refusing on submit.
      canManageAccess={canManageStaffAccess(user)}
    />
  );
}
