import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { optionalId, money, date, transactionAudit } from "@/lib/transactions";
import { isWithdrawnBooking } from "@/lib/receivables";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("ticketing:edit"); const { id } = await ctx.params; const b = await req.json();
    await prisma.$transaction(async tx => {
      const current = await tx.booking.findUnique({ where: { id }, include: { tickets: true, payments: true, Invoice: true } });
      if (!current) throw new ApiError(404, "Booking not found.");
      if (!canTouchRecord(user, current)) throw new ApiError(403, "Booking is outside your access.");
      if (isWithdrawnBooking(current.status)) throw new ApiError(400, "Closed bookings cannot be amended.");
      const pnr = b.pnr === undefined ? current.pnr : optionalId(b.pnr);
      if (current.tickets.length && pnr !== current.pnr) throw new ApiError(400, "Issued tickets need a reissue workflow to change PNR.");
      const financial = ["fare", "taxes", "markup", "serviceFee", "supplierCost"] as const;
      const values = Object.fromEntries(financial.map(key => [key, b[key] === undefined ? current[key] : money(b[key], key)])) as Record<typeof financial[number], number>;
      if (financial.some(key => values[key] !== current[key])) {
        if (!user.permissions.includes("payment:record")) throw new ApiError(403, "Fare corrections require finance recording permission.");
        if (current.tickets.length || current.payments.length || current.Invoice.length) throw new ApiError(400, "Financially committed bookings are locked. Use a reissue or an approved finance adjustment.");
      }
      const supplierId = b.supplierId === undefined ? current.supplierId : optionalId(b.supplierId);
      if (supplierId && !await tx.supplier.findUnique({ where: { id: supplierId } })) throw new ApiError(400, "Supplier not found.");
      const sellingPrice = money(values.fare + values.taxes + values.markup + values.serviceFee);
      await tx.booking.update({ where: { id }, data: { ...values, sellingPrice, pnr, supplierId, status: pnr && current.status === "ENQUIRY" ? "PNR_CREATED" : current.status, airline: b.airline === undefined ? current.airline : optionalId(b.airline), sector: b.sector === undefined ? current.sector : optionalId(b.sector), flightNo: b.flightNo === undefined ? current.flightNo : optionalId(b.flightNo), gdsSource: b.gdsSource === undefined ? current.gdsSource : optionalId(b.gdsSource), travelDate: b.travelDate === undefined ? current.travelDate : date(b.travelDate), ticketingDeadline: b.ticketingDeadline === undefined ? current.ticketingDeadline : date(b.ticketingDeadline) } });
      await transactionAudit(tx, user, "EDIT", "Booking", id, "Booking details corrected");
    });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
