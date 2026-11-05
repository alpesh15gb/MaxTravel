import type { SessionUser } from "./session";

export const canViewInternalFinance = (user: Pick<SessionUser, "permissions">) => user.permissions.includes("finance:internal");

export const isCustomerAccountReport = (report: string) => ["statement", "ageing", "receipts"].includes(report);

export function canReadAccountReport(user: Pick<SessionUser, "permissions">, report: string) {
  return user.permissions.includes("payment:view") && (canViewInternalFinance(user) || isCustomerAccountReport(report));
}

export function canConfirmSupplierCost(user: Pick<SessionUser, "permissions">) {
  return canViewInternalFinance(user) && user.permissions.some(permission => permission === "payment:record" || permission === "supplier:manage");
}
