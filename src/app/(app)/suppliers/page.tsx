import {dateOnly} from "@/lib/master-validation";
import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import SuppliersClient from "./SuppliersClient";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ focus?: string;from?:string;to?:string;status?:string }> }) {
  const user = await requirePage("supplier:view");
  const {focus,from:rawFrom,to:rawTo,status:rawStatus}=await searchParams;
  const validFrom=dateOnly.safeParse(rawFrom??""),validTo=dateOnly.safeParse(rawTo??"");const from=validFrom.success?validFrom.data:"",to=validTo.success?validTo.data:"";const status=["ALL","OPEN","PAID","VOID"].includes(rawStatus??"")?rawStatus!:"ALL";
  const filterError=!validFrom.success||!validTo.success?"Choose valid due dates.":from&&to&&from>to?"Due-date start must be on or before the end date.":"";
  const dueDate={...(from?{gte:new Date(from+"T00:00:00+05:30")}:{}),...(to?{lt:new Date(new Date(to+"T00:00:00+05:30").getTime()+86400000)}:{})};

  const canManage = user.permissions.includes("supplier:manage");
  const [suppliers, bookings,visaCases] = await Promise.all([prisma.supplier.findMany({
    include: {
      dues: {
        where: filterError?{id:"__none__"}:{...(status==="OPEN"?{paid:false}:status==="PAID"?{paid:true,amount:{gt:0}}:status==="VOID"?{paid:true,amount:0}:{}),...(from||to?{dueDate}:{}),...(user.accessMode==="ALL"?{}:{OR:[{booking:{is:scopeWhere(user,"branchId","ownerId")}},{visaCase:{is:scopeWhere(user,"branchId","ownerId")}}]})},
        include: {visaCase:{select:{id:true,caseNo:true}}, booking: { select: { id: true, bookingNo: true } }, settlements: { orderBy: { settledOn: "desc" }, include: { recordedBy: { select: { name: true } }, reversedBy: { select: { name: true } } } } },
        orderBy: { dueDate: "asc" },
      },
      _count: { select: { visaCases: true, bookings: true } },
    },
    orderBy: { name: "asc" },
  }), canManage ? prisma.booking.findMany({ where: {currency:"INR", supplierId: { not: null },AND:[scopeWhere(user,"branchId","ownerId"),{OR:[{gdsSource:null},{gdsSource:{not:"TRIPJACK_API"}}]}] }, select: { id: true, bookingNo: true, product: true, supplierId: true, sector: true, hotelName: true, customer: { select: { name: true } } }, orderBy: { bookingDate: "desc" }, take: 300 }) : Promise.resolve([]),canManage&&user.permissions.includes("visa:view")?prisma.visaCase.findMany({where:{supplierId:{not:null},...scopeWhere(user,"branchId","ownerId")},select:{id:true,caseNo:true,supplierId:true,destination:true,customer:{select:{name:true}}},orderBy:{createdAt:"desc"},take:300}):Promise.resolve([])]);

  return (
    <SuppliersClient dateFilter={{from,to,status,error:filterError,active:Boolean(from||to||status!=="ALL")}} canViewBookings={user.permissions.includes("ticketing:view")}
      suppliers={suppliers.map((s) => ({
        id: s.id, name: s.name, type: s.type, phone: s.phone, city: s.city,
        paymentDueDays: s.paymentDueDays,
        visaCases: s._count.visaCases, bookings: s._count.bookings,
        dues: s.dues.map((d) => ({ id: d.id, description: d.description, supplierInvoiceNo: d.supplierInvoiceNo, bookingId: d.bookingId,visaCaseId:d.visaCaseId,workHref:d.bookingId&&user.permissions.includes("ticketing:view")?"/ticketing/"+d.bookingId:d.visaCaseId&&user.permissions.includes("visa:view")?"/visa/"+d.visaCaseId:null, bookingNo: d.booking?.bookingNo ?? d.visaCase?.caseNo??null, amount: d.amount, paidAmount: d.paidAmount, paid: d.paid, paidOn: d.paidOn?.toISOString() ?? null, dueDate: d.dueDate.toISOString(), settlements: d.settlements.map((p) => ({ id: p.id, amount: p.amount, method: p.method, reference: p.reference, note: p.note, settledOn: p.settledOn.toISOString(), recordedBy: p.recordedBy?.name ?? "Former staff", reversedOn: p.reversedOn?.toISOString() ?? null, reversedBy: p.reversedBy?.name ?? null, reversalReason: p.reversalReason })) })),
      }))}
      focus={focus ?? null}
      canManage={canManage}
      bookings={[...bookings.map((b) => ({ id: b.id, bookingNo: b.bookingNo, product: b.product, supplierId: b.supplierId!, customer: b.customer.name, service: b.product === "HOTEL" ? b.hotelName ?? "Hotel booking" : b.sector ?? "Travel booking" })),...visaCases.map(v=>({id:v.id,bookingNo:v.caseNo,product:"VISA",supplierId:v.supplierId!,customer:v.customer.name,service:v.destination}))]}
    />
  );
}
