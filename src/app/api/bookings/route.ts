import { isReservedBookingSource } from "@/lib/booking-policy";
import { hotelDate, hotelStayProblem } from "@/lib/manual-hotel";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { queueBookingConfirmation } from "@/lib/whatsapp-queue";
import { customerFor, travellersFor, optionalId, nextReference, money, date, transactionAudit } from "@/lib/transactions";
export async function POST(req: Request) {
  try {
    const user = await requireSession("ticketing:create"); const b = await req.json();
    const product=b.product??"FLIGHT";
    if(product!=="FLIGHT"&&product!=="HOTEL")throw new ApiError(400,"Choose a flight or hotel booking.");
    if (isReservedBookingSource(b.gdsSource)) throw new ApiError(400, "Online booking sources can only be set by the booking integration.");
    const customerId = optionalId(b.customerId); if (!customerId) throw new ApiError(400, "Select a customer.");
    const fare=money(b.fare,"Fare"),taxes=money(b.taxes,"Taxes"),markup=money(b.markup,"Markup"),serviceFee=money(b.serviceFee,"Service fee"),supplierCost=money(b.supplierCost,"Supplier cost");
    const hours=product==="FLIGHT"?Number(b.deadlineHours??0):0;
    if(!Number.isFinite(hours)||hours<0||hours>8760)throw new ApiError(400,"Deadline must be between 0 and 8760 hours.");
    const hotelName=product==="HOTEL"?optionalId(b.hotelName):null;
    let hotelCheckIn:Date|null=null,hotelCheckOut:Date|null=null;
    if(product==="HOTEL"){
      try { hotelCheckIn=hotelDate(b.hotelCheckIn);hotelCheckOut=hotelDate(b.hotelCheckOut); }
      catch { throw new ApiError(400,"Use valid hotel stay dates (YYYY-MM-DD)."); }
      if(!hotelName||!hotelCheckIn||!hotelCheckOut)throw new ApiError(400,"Enter the hotel name, check-in and check-out dates.");
      const problem=hotelStayProblem({hotelName,hotelCheckIn,hotelCheckOut,pnr:optionalId(b.pnr)});
      if(problem)throw new ApiError(400,problem);
    }
    const travelDate=product==="HOTEL"?hotelCheckIn:date(b.travelDate,"Travel date");
    const booking=await prisma.$transaction(async tx=>{
      const customer=await customerFor(tx,user,customerId); const travellers=await travellersFor(tx,customerId,b.travellerIds);
      const supplierId=optionalId(b.supplierId); if(supplierId&&!(await tx.supplier.findUnique({where:{id:supplierId}})))throw new ApiError(400,"Supplier not found.");
      const pnr=optionalId(b.pnr);
      const record=await tx.booking.create({data:{bookingNo:await nextReference(tx, "BK"),customerId,product,hotelName,hotelCheckIn,hotelCheckOut,pnr,airline:product==="FLIGHT"?optionalId(b.airline):null,gdsSource:product==="FLIGHT"?optionalId(b.gdsSource):"Direct",supplierId,status:product==="FLIGHT"&&pnr?"PNR_CREATED":"ENQUIRY",sector:optionalId(b.sector),flightNo:product==="FLIGHT"?optionalId(b.flightNo):null,travelDate,ticketingDeadline:product==="FLIGHT"&&pnr&&hours>0?new Date(Date.now()+hours*3600000):null,fare,taxes,markup,serviceFee,supplierCost,sellingPrice:money(fare+taxes+markup+serviceFee,"Selling price"),ownerId:user.id,branchId:customer.branchId,travellers:{create:travellers.map(t=>({travellerId:t.id}))}}});
      await transactionAudit(tx,user,"CREATE","Booking",record.id,record.bookingNo);
      await tx.activity.create({data:{customerId,actorId:user.id,type:"BOOKING",summary:`Booking ${record.bookingNo} created`,link:`/ticketing/${record.id}`}});
      await queueBookingConfirmation(tx, record.id);
      return record;
    });
    return Response.json({ok:true,bookingId:booking.id,bookingNo:booking.bookingNo});
  }catch(e){return jsonError(e);}
}
