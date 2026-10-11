import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { customerFor, travellersFor, optionalId, nextReference, money, date, transactionAudit } from "@/lib/transactions";
export async function POST(req: Request) {
  try {
    const user = await requireSession("ticketing:create"); const b = await req.json();
    const customerId = optionalId(b.customerId); if (!customerId) throw new ApiError(400, "Select a customer.");
    const fare=money(b.fare,"Fare"),taxes=money(b.taxes,"Taxes"),markup=money(b.markup,"Markup"),serviceFee=money(b.serviceFee,"Service fee"),supplierCost=money(b.supplierCost,"Supplier cost");
    const hours=Number(b.deadlineHours??0);
    if(!Number.isFinite(hours)||hours<0||hours>8760)throw new ApiError(400,"Deadline must be between 0 and 8760 hours.");
    const travelDate=date(b.travelDate,"Travel date");
    const booking=await prisma.$transaction(async tx=>{
      const customer=await customerFor(tx,user,customerId); const travellers=await travellersFor(tx,customerId,b.travellerIds);
      const supplierId=optionalId(b.supplierId); if(supplierId&&!(await tx.supplier.findUnique({where:{id:supplierId}})))throw new ApiError(400,"Supplier not found.");
      const pnr=optionalId(b.pnr);
      const record=await tx.booking.create({data:{bookingNo:await nextReference(tx, "BK"),customerId,pnr,airline:optionalId(b.airline),gdsSource:optionalId(b.gdsSource),supplierId,status:pnr?"PNR_CREATED":"ENQUIRY",sector:optionalId(b.sector),flightNo:optionalId(b.flightNo),travelDate,ticketingDeadline:pnr&&hours>0?new Date(Date.now()+hours*3600000):null,fare,taxes,markup,serviceFee,supplierCost,sellingPrice:money(fare+taxes+markup+serviceFee,"Selling price"),ownerId:user.id,branchId:customer.branchId,travellers:{create:travellers.map(t=>({travellerId:t.id}))}}});
      await transactionAudit(tx,user,"CREATE","Booking",record.id,record.bookingNo);
      await tx.activity.create({data:{customerId,actorId:user.id,type:"BOOKING",summary:`Booking ${record.bookingNo} created`,link:`/ticketing/${record.id}`}});
      return record;
    });
    return Response.json({ok:true,bookingId:booking.id,bookingNo:booking.bookingNo});
  }catch(e){return jsonError(e);}
}
