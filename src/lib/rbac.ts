import type { AccessMode, Permission, RoleKey } from "./permissions";
import { ROLE_ACCESS, ROLE_PERMISSIONS } from "./permissions";

export { ROLE_ACCESS, ROLE_PERMISSIONS };
export type { AccessMode, Permission, RoleKey };

export function can(perms: Permission[] | undefined, p: Permission): boolean {
  if (!perms) return false;
  return perms.includes(p);
}

export function canAny(perms: Permission[] | undefined, ps: Permission[]): boolean {
  if (!perms) return false;
  return ps.some((p) => perms.includes(p));
}

export function accessModeFor(role: RoleKey): AccessMode {
  return ROLE_ACCESS[role] ?? "ASSIGNED";
}

export const MODULE_PERMISSION: Record<string, Permission> = {
  customers: "customer:view",
  travellers: "traveller:view",
  visa: "visa:view",
  checklists: "checklist:view",
  ticketing: "ticketing:view",
  documents: "document:view",
  payments: "payment:view",
  reports: "payment:view",
  invoices: "invoice:view",
  refunds: "refund:view",
  suppliers: "supplier:view",
  tasks: "task:view",
  whatsapp: "whatsapp:view",
  employees: "employee:view",
  settings: "settings:manage",
  audit: "audit:view",
};
