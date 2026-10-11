import type { SessionUser } from "./session";
import { can } from "./rbac";

export type CustomerJSON = {
  id: string; code: string; name: string; type: string; phone: string; email: string | null;
  city: string; status: string; branch: string; manager: string | null; companyName: string | null;
  createdAt: string;
};

export function mapCustomer(c: {
  id: string; code: string; name: string; type: string; phone: string; email: string | null;
  city: string; status: string; companyName: string | null; createdAt: Date;
  branch?: { name: string } | null; assignedTo?: { name: string } | null;
}): CustomerJSON {
  return {
    id: c.id, code: c.code, name: c.name, type: c.type, phone: c.phone, email: c.email,
    city: c.city, status: c.status, branch: c.branch?.name ?? "—", manager: c.assignedTo?.name ?? null,
    companyName: c.companyName, createdAt: c.createdAt.toISOString(),
  };
}

/** Mask passport unless the viewer holds sensitive:view. */
export function maskPassportFor(user: SessionUser, pp: string | null | undefined): string | null {
  if (!pp) return null;
  if (can(user.permissions, "sensitive:view")) return pp;
  return "••••••" + pp.slice(-4);
}

/** Hide salary/bank unless hr:view. */
export function hrVisible(user: SessionUser) {
  return can(user.permissions, "hr:view");
}

