import type {Prisma} from "@prisma/client";
import type {SessionUser} from "./session";
import {ApiError,canTouchRecord} from "./guard";
import {customerFor} from "./transactions";
export async function privatePdfFor(db:Prisma.TransactionClient,user:SessionUser,id:string){
 if(!user.permissions.includes("document:view"))throw new ApiError(403,"You do not have access to private documents.");
 const attachment=await db.privatePdfAttachment.findUnique({where:{id}});
 if(!attachment)throw new ApiError(404,"PDF not found.");
 await customerFor(db,user,attachment.customerId);
 if(id.startsWith("platform-pdf-")){
  const match=/^platform-pdf-(.+)-(\d+)$/.exec(id);
  if(!match)throw new ApiError(409,"This supplier document cannot be verified.");
  if(!user.permissions.includes("ticketing:view"))throw new ApiError(403,"Booking access is required for this document.");
  const link=await db.platformBookingLink.findUnique({where:{platformId:match[1]}});
  const booking=link?await db.booking.findUnique({where:{id:link.bookingId}}):null;
  if(!booking||!canTouchRecord(user,booking)||booking.customerId!==attachment.customerId)throw new ApiError(404,"Booking document unavailable.");
  if(!link?.documentsCurrent||link.revision!==Number(match[2])||!["CONFIRMED","TICKETED"].includes(booking.status))throw new ApiError(409,"This supplier document has been superseded or is no longer confirmed. Refresh the booking for its current status.");
 }
 return attachment;
}
