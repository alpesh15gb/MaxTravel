import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import NewBooking from "./NewBooking";

export const dynamic = "force-dynamic";

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePage("ticketing:create");
  const { customer } = await searchParams;

  const where: Record<string, unknown> = {};
  if (user.accessMode === "BRANCH") where.branchId = user.branchId;
  if (user.accessMode === "ASSIGNED") where.OR = [{ assignedToId: user.id }, { id: user.id }];

  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: { id: true, name: true, code: true, travellers: { select: { id: true, fullName: true, relation: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return <NewBooking customers={customers} suppliers={suppliers} defaultCustomerId={customer ?? null} />;
}
