import { ROLE_ACCESS, type RoleKey } from "./permissions";

/** Explain the effective role permissions at the point where an owner grants them. */
export function roleDescription(key: string, permissions: string[]) {
  const scope = ROLE_ACCESS[key as RoleKey] ?? "ASSIGNED";
  const parts = [scope === "ALL" ? "Agency-wide access to permitted records." : scope === "BRANCH" ? "Permitted records in the assigned branch." : "Assigned records only."];
  if (key === "READ_ONLY") parts.push("View only; no changes to records.");
  parts.push(permissions.includes("finance:internal") ? "Can view internal costs and profit." : "Internal costs and profit are hidden.");
  if (permissions.includes("hr:view")) parts.push("Can view employee salary and bank details.");
  parts.push(["OWNER", "SUPER_ADMIN"].includes(key) ? "Can create accounts and change staff access." : "Cannot change staff login access.");
  return parts.join(" ");
}
