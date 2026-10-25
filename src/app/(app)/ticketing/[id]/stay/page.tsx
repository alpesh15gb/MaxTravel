import Link from "next/link";
import {notFound} from "next/navigation";
import {prisma} from "@/lib/db";
import {requirePage,canTouchRecord} from "@/lib/guard";
import {dateLabel} from "@/lib/dates";
import {enumLabel} from "@/lib/labels";
import PrintButton from "@/app/(app)/payments/print/PrintButton";
export const dynamic="force-dynamic";
export default async function StayRecord({params}:{params:Promise<{id:string}>}){
 const user=await requirePage("ticketing:view"),{id}=await params;
 const booking=await prisma.booking.findUnique({where:{id},include:{customer:{select:{name:true}},branch:{select:{name:true}},travellers:{include:{traveller:{select:{fullName:true}}}}}});
 if(!booking||!canTouchRecord(user,booking)||booking.product!=="HOTEL"||booking.gdsSource==="TRIPJACK_API")notFound();
 const rows=[["CRM reference",booking.bookingNo],["Current status",enumLabel(booking.status)],["Customer",booking.customer.name],["Hotel",booking.hotelName??"Not entered"],["Check-in",booking.hotelCheckIn?dateLabel(booking.hotelCheckIn):"Not entered"],["Check-out",booking.hotelCheckOut?dateLabel(booking.hotelCheckOut):"Not entered"],["Supplier confirmation reference",booking.pnr??"Not entered"]];
 return <article className="mx-auto w-full max-w-2xl min-w-0 space-y-5 bg-white p-4 text-slate-900 sm:p-8 print:p-0"><Link className="btn-secondary print:hidden" href={`/ticketing/${id}`}>Back to hotel stay</Link><header><h1 className="text-2xl font-bold">Hotel stay record</h1><p className="mt-2 break-words text-sm">{booking.branch.name} · agency-maintained record</p></header><p className="rounded-lg border p-3 text-sm">{booking.status==="CONFIRMED"?"Supplier confirmation has been recorded by the agency; the CRM has not independently verified it.":"This record does not represent a confirmed hotel stay. Review its current status with the agency."} This is not a hotel voucher. Creating or printing this record does not reserve a room, issue a voucher or make a payment.</p><dl className="divide-y rounded-lg border px-3">{rows.map(([label,value])=><div key={label} className="grid min-w-0 gap-1 py-3 text-sm sm:grid-cols-2"><dt className="font-medium">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl><section><h2 className="font-semibold">Recorded guests</h2>{booking.travellers.length?<ul className="mt-2 space-y-1 text-sm">{booking.travellers.map(t=><li className="break-words" key={t.travellerId}>{t.traveller.fullName}</li>)}</ul>:<p className="text-sm">No guests recorded. Confirm the guest list directly with the agency and supplier.</p>}</section><PrintButton/></article>;
}
