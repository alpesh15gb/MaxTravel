import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import SuppliersClient from "./SuppliersClient";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requirePage("supplier:view");
  const { focus } = await searchParams;

  const canManage = user.permissions.includes("supplier:manage");
  const [suppliers, bookings] = await Promise.all([prisma.supplier.findMany({
    include: {
      dues: {
        where: user.accessMode === "ALL" ? { OR: [{ paid: false }, { paidAmount: { gt: 0 } }] } : { id: "__none__" },
        include: { booking: { select: { id: true, bookingNo: true } }, settlements: { orderBy: { settledOn: "desc" }, include: { recordedBy: { select: { name: true } }, reversedBy: { select: { name: true } } } } },
        orderBy: { dueDate: "asc" },
      },
      _count: { select: { visaCases: true, bookings: true } },
    },
    orderBy: { name: "asc" },
  }), canManage ? prisma.booking.findMany({ where: { supplierId: { not: null }, gdsSource: { not: "TRIPJACK_API" }, ...scopeWhere(user, "branchId", "ownerId") }, select: { id: true, bookingNo: true, product: true, supplierId: true, sector: true, hotelName: true, customer: { select: { name: true } } }, orderBy: { bookingDate: "desc" }, take: 300 }) : Promise.resolve([])]);

  return (
    <SuppliersClient canViewBookings={user.permissions.includes("ticketing:view")}
      suppliers={suppliers.map((s) => ({
        id: s.id, name: s.name, type: s.type, phone: s.phone, city: s.city,
        paymentDueDays: s.paymentDueDays,
        visaCases: s._count.visaCases, bookings: s._count.bookings,
        dues: s.dues.map((d) => ({ id: d.id, description: d.description, supplierInvoiceNo: d.supplierInvoiceNo, bookingId: d.bookingId, bookingNo: d.booking?.bookingNo ?? null, amount: d.amount, paidAmount: d.paidAmount, paid: d.paid, paidOn: d.paidOn?.toISOString() ?? null, dueDate: d.dueDate.toISOString(), settlements: d.settlements.map((p) => ({ id: p.id, amount: p.amount, method: p.method, reference: p.reference, note: p.note, settledOn: p.settledOn.toISOString(), recordedBy: p.recordedBy?.name ?? "Former staff", reversedOn: p.reversedOn?.toISOString() ?? null, reversedBy: p.reversedBy?.name ?? null, reversalReason: p.reversalReason })) })),
      }))}
      focus={focus ?? null}
      canManage={canManage}
      bookings={bookings.map((b) => ({ id: b.id, bookingNo: b.bookingNo, product: b.product, supplierId: b.supplierId!, customer: b.customer.name, service: b.product === "HOTEL" ? b.hotelName ?? "Hotel booking" : b.sector ?? "Flight booking" }))}
    />
  );
}
