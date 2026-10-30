import {resolveServiceCase,customerForCase} from "@/lib/service-cases";
import { checklistMatches, requirementApplies } from "@/lib/visa-checklist";
import { queueDocumentRequest } from "@/lib/whatsapp-queue";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { travellersFor, optionalId, nextReference, money, date, transactionAudit } from "@/lib/transactions";
export async function POST(req: Request) {
  try {
    const user=await requireSession("visa:create"); const b=await req.json();
    const customerId=optionalId(b.customerId),destination=optionalId(b.destination),visaType=optionalId(b.visaType);
    if(!customerId||!destination||!visaType)throw new ApiError(400,"Select a customer, destination and visa type.");
    const visaFee=money(b.visaFee,"Visa fee"),serviceFee=money(b.serviceFee,"Service fee"),sellingPrice=money(b.sellingPrice??visaFee+serviceFee,"Selling price");
    const travelDate=date(b.travelDate,"Travel date");
    const vc=await prisma.$transaction(async tx=>{
      const customer=await customerForCase(tx,user,customerId,b.serviceCaseId); const travellers=await travellersFor(tx,customerId,b.travellerIds);
      const enquiry=await tx.visaStage.findUnique({where:{key:"ENQUIRY"}});if(!enquiry?.active)throw new ApiError(400,"The enquiry stage must be active before creating a case.");
      const checklistId=optionalId(b.checklistId);const checklist=checklistId?await tx.checklist.findUnique({where:{id:checklistId},include:{items:{orderBy:{sortOrder:"asc"}}}}):null;
      if(checklistId&&!checklist?.active)throw new ApiError(400,"Choose an active checklist.");
      if(checklist&&!checklistMatches(checklist,destination,visaType))throw new ApiError(400,"Choose an active checklist for the case destination and visa type.");
      const journey=await resolveServiceCase(tx,user,{caseId:b.serviceCaseId,customerId,branchId:customer.branchId,ownerId:user.id,service:"VISA",title:`${destination} · ${visaType}`});
      const record=await tx.visaCase.create({data:{serviceCaseId:journey.id,caseNo:await nextReference(tx, "VC"),customerId,stageId:enquiry.id,destination,visaType,visaCategory:optionalId(b.visaCategory),travelDate,intendedStay:optionalId(b.intendedStay),visaFee,serviceFee,sellingPrice,ownerId:user.id,branchId:customer.branchId,internalNotes:optionalId(b.notes),travellers:{create:travellers.map(t=>({travellerId:t.id,applicantType:checklist?.applicantType??"SALARIED"}))},history:{create:{stageId:enquiry.id,note:"Case created",byId:user.id}}}});
      if(checklist){
        for(const traveller of travellers){
          await tx.checklistLink.create({data:{caseId:record.id,checklistId:checklist.id,travellerId:traveller.id}});
          for(const item of checklist.items){
            let applies: boolean;
            try { applies=requirementApplies(item.travellerType,traveller.dateOfBirth,travelDate??new Date()); } catch(e) { throw new ApiError(400,(e as Error).message); }
            if(!applies)continue;
            await tx.document.create({data:{docNo:await nextReference(tx, "DOC"),customerId,travellerId:traveller.id,visaCaseId:record.id,docType:item.name,status:"REQUIRED",checklistItemId:item.id,notes:item.instructions}});
          }
        }
      }
      await transactionAudit(tx,user,"CREATE","VisaCase",record.id,record.caseNo);
      await tx.activity.create({data:{customerId,actorId:user.id,type:"VISA",summary:`Visa case ${record.caseNo} created for ${destination}`,link:`/visa/${record.id}`}});
      await queueDocumentRequest(tx, record.id, record.id);
      return {...record,caseReference:journey.caseNo};
    },{timeout:20000});
    return Response.json({ok:true,caseId:vc.id,caseNo:vc.caseNo,serviceCaseId:vc.serviceCaseId,serviceCaseNo:vc.caseReference});
  }catch(e){return jsonError(e);}
}
