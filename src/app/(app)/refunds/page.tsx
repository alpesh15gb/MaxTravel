import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import RefundsClient from "./RefundsClient";

export const dynamic = "force-dynamic";

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requirePage("refund:view");
  const { focus } = await searchParams;
  const refunds = await prisma.refund.findMany({
    where: { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } },
    include: { customer: { select: { name: true, code: true } }, booking: { select: { bookingNo: true, id: true } } },
    orderBy: [{ requestedOn: "desc" }],
  });

  const bookings = await prisma.booking.findMany({ where: { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } }, include: { customer: { select: { name: true } }, payments: { select: { amount: true } }, refunds: { where: { status: { not: "REJECTED" } }, select: { amount: true } } } });
  return (
    <RefundsClient
      canApprove={user.permissions.includes("refund:approve")}
      bookings={bookings.map(b => ({ id: b.id, customerId: b.customerId, label: `${b.customer.name} · ${b.bookingNo}`, refundable: b.payments.reduce((s,p)=>s+p.amount,0)-b.refunds.reduce((s,r)=>s+r.amount,0) }))}
      canExport={user.permissions.includes("export:data")}
      refunds={refunds.map((r) => ({
        id: r.id, refundNo: r.refundNo, customer: r.customer.name, customerId: r.customerId,
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
