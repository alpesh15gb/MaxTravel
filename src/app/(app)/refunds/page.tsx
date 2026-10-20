import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { bookingCharge, cancellationRefundAvailable, isWithdrawnBooking, unencumberedBalance } from "@/lib/receivables";
import RefundsClient from "./RefundsClient";

export const dynamic = "force-dynamic";

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requirePage("refund:view");
  const { focus } = await searchParams;
  const customerScope = scopeWhere(user, null, undefined, "assignedToId");
  const bookingScope = scopeWhere(user, null, "ownerId");
  const refunds = await prisma.refund.findMany({
    where: { AND: [{ customer: { is: customerScope } }, { OR: [{ bookingId: null }, { booking: { is: bookingScope } }] }] },
    include: { customer: { select: { name: true, code: true } }, booking: { select: { bookingNo: true, id: true, gdsSource: true } } },
    orderBy: [{ requestedOn: "desc" }],
  });

  const bookings = await prisma.booking.findMany({ where: { AND: [bookingScope, { customer: { is: customerScope } }, { OR: [{ gdsSource: null }, { gdsSource: { not: "TRIPJACK_API" } }] }] }, include: { customer: { select: { name: true } }, payments: { select: { amount: true } }, refunds: { select: { amount: true, status: true } } } });
  return (
    <RefundsClient
      canAudit={user.permissions.includes("audit:view")}
      canViewBookings={user.permissions.includes("ticketing:view")}
      canApprove={user.permissions.includes("refund:approve")}
      bookings={bookings.map(b => ({ id: b.id, customerId: b.customerId, label: `${b.customer.name} · ${b.bookingNo}${isWithdrawnBooking(b.status)?" · after recorded cancellation charges":""}`, refundable: isWithdrawnBooking(b.status) ? cancellationRefundAvailable(bookingCharge(b), b.payments.reduce((s,p)=>s+p.amount,0), b.refunds) : unencumberedBalance(b.payments.reduce((s,p)=>s+p.amount,0), b.refunds) }))}
      canExport={user.permissions.includes("export:data")}
      refunds={refunds.map((r) => ({
        id: r.id, refundNo: r.refundNo, customer: r.customer.name, customerId: r.customerId,
        externallyManaged: r.booking?.gdsSource === "TRIPJACK_API",
        amount: r.amount, reason: r.reason, status: r.status,
        requestedOn: r.requestedOn.toISOString(),
        supplierSentOn: r.supplierSentOn?.toISOString() ?? null,
        supplierReceivedOn: r.supplierReceivedOn?.toISOString() ?? null,
        paidOn: r.paidOn?.toISOString() ?? null,
        booking: r.booking ? { bookingNo: r.booking.bookingNo, id: r.booking.id } : null,
      }))}
      focus={focus ?? null}
      canManage={user.permissions.includes("refund:manage")}
    />
  );
}
