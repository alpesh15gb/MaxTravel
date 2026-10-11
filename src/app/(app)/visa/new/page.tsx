import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import NewVisaCase from "./NewVisaCase";

export const dynamic = "force-dynamic";

export default async function NewVisaCasePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePage("visa:create");
  const { customer } = await searchParams;

  const where: Record<string, unknown> = {};
  if (user.accessMode === "BRANCH") where.branchId = user.branchId;
  if (user.accessMode === "ASSIGNED") where.OR = [{ assignedToId: user.id }, { id: user.id }];

  const [customers, checklists] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: { id: true, name: true, code: true, travellers: { select: { id: true, fullName: true, relation: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.checklist.findMany({
      where: { active: true },
      select: { id: true, country: true, visaType: true, applicantType: true, version: true },
      orderBy: [{ country: "asc" }, { visaType: "asc" }],
    }),
  ]);

  return (
    <NewVisaCase
      customers={customers}
      checklists={checklists}
      defaultCustomerId={customer ?? null}
      canCreate={user.permissions.includes("visa:create")}
    />
  );
}
