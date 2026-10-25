import { hotelDate, hotelStayProblem } from "@/lib/manual-hotel";
import { isReservedBookingSource } from "@/lib/booking-policy";
import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { optionalId, money, date, text, transactionAudit, travellersFor } from "@/lib/transactions";
import { isWithdrawnBooking } from "@/lib/receivables";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("ticketing:edit"); const { id } = await ctx.params; const b = await req.json();
    if (isReservedBookingSource(b.gdsSource)) throw new ApiError(400, "Online booking sources can only be set by the booking integration.");
    await prisma.$transaction(async tx => {
      const current = await tx.booking.findUnique({ where: { id }, include: { tickets: true, payments: true, Invoice: true } });
      if (!current) throw new ApiError(404, "Booking not found.");
      if (current.gdsSource === "TRIPJACK_API") throw new ApiError(409,"Manage online bookings from the booking platform.");
      if (!canTouchRecord(user, current)) throw new ApiError(403, "Booking is outside your access.");
      if (isWithdrawnBooking(current.status)) throw new ApiError(400, "Closed bookings cannot be amended.");
      if (b.travellerIds !== undefined) {
        if (current.tickets.length) throw new ApiError(400, "Issued tickets lock the passenger list. Use a reissue or a new booking for passenger changes.");
        const travellers = await travellersFor(tx, current.customerId, b.travellerIds);
        await tx.bookingTraveller.deleteMany({ where: { bookingId: id } });
        await tx.bookingTraveller.createMany({ data: travellers.map(traveller => ({ bookingId: id, travellerId: traveller.id })) });
      }
      const hotel = current.product === "HOTEL";
      if(hotel && ["airline","flightNo","ticketingDeadline"].some(key=>b[key]!==undefined))throw new ApiError(400,"Hotel stays do not have airline tickets or ticketing deadlines.");
      const pnr = b.pnr === undefined ? current.pnr : hotel ? text(b.pnr,"Supplier confirmation reference",100) : optionalId(b.pnr);
      let hotelCheckIn=current.hotelCheckIn,hotelCheckOut=current.hotelCheckOut;
      try{if(hotel&&b.hotelCheckIn!==undefined)hotelCheckIn=hotelDate(b.hotelCheckIn);if(hotel&&b.hotelCheckOut!==undefined)hotelCheckOut=hotelDate(b.hotelCheckOut);}catch(e){throw new ApiError(400,e instanceof Error?e.message:"Invalid stay dates.");}
      const hotelName=hotel&&b.hotelName!==undefined?text(b.hotelName,"Hotel name",200):current.hotelName;
      if(hotel){const problem=hotelStayProblem({hotelName,hotelCheckIn,hotelCheckOut,pnr},current.status==="CONFIRMED");if(problem)throw new ApiError(400,problem);}
      else if(["hotelName","hotelCheckIn","hotelCheckOut"].some(key=>b[key]!==undefined))throw new ApiError(400,"Hotel stay fields only apply to hotel bookings.");
      if (current.tickets.length && pnr !== current.pnr) throw new ApiError(400, "Issued tickets need a reissue workflow to change PNR.");
      const financial = ["fare", "taxes", "markup", "serviceFee", "supplierCost"] as const;
      const values = Object.fromEntries(financial.map(key => [key, b[key] === undefined ? current[key] : money(b[key], key)])) as Record<typeof financial[number], number>;
      if (financial.some(key => values[key] !== current[key])) {
        if (!user.permissions.includes("payment:record")) throw new ApiError(403, "Fare corrections require finance recording permission.");
        if (current.tickets.length || current.payments.length || current.Invoice.length) throw new ApiError(400, "Financially committed bookings are locked. Use a reissue or an approved finance adjustment.");
      }
      const supplierId = b.supplierId === undefined ? current.supplierId : optionalId(b.supplierId);
      if (supplierId && !await tx.supplier.findUnique({ where: { id: supplierId } })) throw new ApiError(400, "Supplier not found.");
      if(hotel&&current.status==="CONFIRMED"&&(hotelName!==current.hotelName||pnr!==current.pnr||hotelCheckIn?.getTime()!==current.hotelCheckIn?.getTime()||hotelCheckOut?.getTime()!==current.hotelCheckOut?.getTime()||supplierId!==current.supplierId))throw new ApiError(409,"Confirmed hotel stay details are locked. Record cancellation terms and create a new stay for changed supplier arrangements.");
      const sellingPrice = money(values.fare + values.taxes + values.markup + values.serviceFee);
      await tx.booking.update({ where: { id }, data: { ...values, sellingPrice, pnr, supplierId, hotelName,hotelCheckIn,hotelCheckOut,status: !hotel && pnr && current.status === "ENQUIRY" ? "PNR_CREATED" : current.status, airline: b.airline === undefined ? current.airline : optionalId(b.airline), sector: b.sector === undefined ? current.sector : optionalId(b.sector), flightNo: b.flightNo === undefined ? current.flightNo : optionalId(b.flightNo), gdsSource: b.gdsSource === undefined ? current.gdsSource : optionalId(b.gdsSource), travelDate: b.travelDate === undefined ? current.travelDate : date(b.travelDate), ticketingDeadline: b.ticketingDeadline === undefined ? current.ticketingDeadline : date(b.ticketingDeadline) } });
      await transactionAudit(tx, user, "EDIT", "Booking", id, "Booking details corrected");
    });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
