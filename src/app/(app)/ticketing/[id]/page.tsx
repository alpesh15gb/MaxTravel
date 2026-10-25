import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage, canTouchRecord } from "@/lib/guard";
import { can } from "@/lib/rbac";
import BookingView from "./BookingView";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("ticketing:view");
  const { id } = await params;

  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      customer: { include: { travellers: true } },
      supplier: true,
      owner: { select: { name: true } },
      branch: { select: { name: true } },
      travellers: { include: { traveller: true } },
      tickets: true,
      payments: { orderBy: { receivedOn: "desc" } },
      refunds: { orderBy: { requestedOn: "desc" } },
      reissuesIssued: { include: { supplier: true } },
      reissueChain: { include: { supplier: true } },
      reissueOf: { select: { id: true, bookingNo: true, pnr: true } },
    },
  });
  if (!b || !canTouchRecord(user, b)) notFound();
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  // Fare, receipts and refunds are financial position: hidden without payment:view, like the
  // list-page balance and Customer 360. Masking happens here so the client never receives them.
  const showMoney = can(user.permissions, "payment:view");

  return (
    <BookingView
      b={{
        id: b.id, bookingNo: b.bookingNo, product:b.product, hotelName:b.hotelName, hotelCheckIn:b.hotelCheckIn?.toISOString()??null,hotelCheckOut:b.hotelCheckOut?.toISOString()??null, supplierId:b.supplierId,
        customer: { id: b.customer.id, name: b.customer.name, code: b.customer.code, phone: b.customer.phone },
        pnr: b.pnr, airline: b.airline, gdsSource: b.gdsSource, supplier: b.supplier?.name ?? null,
        cancellationSupplierCharge: showMoney ? b.cancellationSupplierCharge : null,
        cancellationAgencyFee: showMoney ? b.cancellationAgencyFee : null,
        cancellationReason: b.cancellationReason,
        status: b.status, sector: b.sector, flightNo: b.flightNo,
        travelDate: b.travelDate?.toISOString() ?? null,
        bookingDate: b.bookingDate.toISOString(),
        ticketingDeadline: b.ticketingDeadline?.toISOString() ?? null,
        fare: showMoney ? b.fare : 0, taxes: showMoney ? b.taxes : 0, markup: showMoney ? b.markup : 0,
        serviceFee: showMoney ? b.serviceFee : 0,
        sellingPrice: showMoney ? b.sellingPrice : 0, supplierCost: showMoney ? b.supplierCost : 0, currency: b.currency,
        owner: b.owner.name, branch: b.branch.name,
        travellers: b.travellers.map((bt) => ({
          id: bt.traveller.id, fullName: bt.traveller.fullName, relation: bt.traveller.relation,
          passportNumber: can(user.permissions, "sensitive:view")
            ? bt.traveller.passportNumber
            : bt.traveller.passportNumber ? "••••••" + (bt.traveller.passportNumber ?? "").slice(-4) : null,
        })),
        tickets: b.tickets.map((t) => ({
          id: t.id, travellerId: t.travellerId, ticketNo: t.ticketNo, passenger: t.passenger,
          issueDate: t.issueDate?.toISOString() ?? null, issuedBy: t.issuedBy,
          originalFare: showMoney ? t.originalFare : 0, status: t.status,
        })),
        payments: showMoney ? b.payments.map((p) => ({ id: p.id, receiptNo: p.receiptNo, amount: p.amount, mode: p.mode, receivedOn: p.receivedOn.toISOString() })) : [],
        refunds: (showMoney ? b.refunds : []).map((r) => ({
          id: r.id, refundNo: r.refundNo, amount: r.amount, reason: r.reason, status: r.status,
          requestedOn: r.requestedOn.toISOString(), paidOn: r.paidOn?.toISOString() ?? null,
        })),
        reissues: [...b.reissueChain, ...b.reissuesIssued].map((r) => ({
          id: r.id, reason: r.reason, fareDifference: showMoney ? r.fareDifference : 0, penalty: showMoney ? r.penalty : 0,
          supplier: r.supplier?.name ?? null, status: r.status,
          reissuedBooking: r.reissuedBookingId,
          createdAt: r.createdAt.toISOString(),
        })),
        reissueOf: b.reissueOf ? { bookingNo: b.reissueOf.bookingNo, id: b.reissueOf.id, pnr: b.reissueOf.pnr } : null,
      }}
      passengerOptions={b.customer.travellers.map(t => ({ id: t.id, fullName: t.fullName }))}
      suppliers={suppliers}
      perms={{
        audit: can(user.permissions, "audit:view"),
        edit: b.gdsSource !== "TRIPJACK_API" && can(user.permissions, "ticketing:edit"),
        record: b.gdsSource !== "TRIPJACK_API" && can(user.permissions, "payment:record"),
        invoice: b.gdsSource !== "TRIPJACK_API" && can(user.permissions, "invoice:create"),
        send: can(user.permissions, "whatsapp:send"),
        reissue: b.gdsSource !== "TRIPJACK_API" && can(user.permissions, "reissue:manage"),
        money: showMoney,
        // Cancelling a sale that still holds customer money raises a refund, so it needs refund:manage.
        refund: can(user.permissions, "refund:manage"),
      }}
    />
  );
}
