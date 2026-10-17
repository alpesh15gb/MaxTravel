import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { mapCustomer } from "@/lib/serialize";
import { dateLabel } from "@/lib/dates";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requirePage("customer:view");
  const where: Record<string, unknown> = {mergedIntoId:null};
  if (user.accessMode === "BRANCH") where.branchId = user.branchId;
  if (user.accessMode === "ASSIGNED") where.OR = [{ assignedToId: user.id }, { id: user.id }];

  const customers = await prisma.customer.findMany({
    where,
    include: { branch: { select: { name: true } }, assignedTo: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <CustomersClient
      customers={customers.map(c => ({ ...mapCustomer(c), createdLabel: dateLabel(c.createdAt) }))}
      canCreate={user.permissions.includes("customer:create")}
      canExport={can(user.permissions, "export:data")}
    />
  );
}
