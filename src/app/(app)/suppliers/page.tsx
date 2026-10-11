import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import SuppliersClient from "./SuppliersClient";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requirePage("supplier:view");
  const { focus } = await searchParams;

  const suppliers = await prisma.supplier.findMany({
    include: {
      dues: { where: user.accessMode === "ALL" ? { OR: [{ paid: false }, { paidAmount: { gt: 0 } }] } : { id: "__none__" }, orderBy: { dueDate: "asc" } },
      _count: { select: { visaCases: true, bookings: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <SuppliersClient
      suppliers={suppliers.map((s) => ({
        id: s.id, name: s.name, type: s.type, phone: s.phone, city: s.city,
        paymentDueDays: s.paymentDueDays,
        visaCases: s._count.visaCases, bookings: s._count.bookings,
        dues: s.dues.map((d) => ({ id: d.id, description: d.description, amount: d.amount, paidAmount: d.paidAmount, paid: d.paid, paidOn: d.paidOn?.toISOString() ?? null, dueDate: d.dueDate.toISOString() })),
      }))}
      focus={focus ?? null}
      canManage={user.permissions.includes("supplier:manage")}
    />
  );
}
