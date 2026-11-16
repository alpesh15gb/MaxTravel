import {createHash} from 'node:crypto';
import {z} from 'zod';
import {prisma} from './db';
import {ApiError} from './guard';
import {createServiceCase,roleCanOwnCase} from './service-cases';
import {nextReference} from './transactions';

const text=(min:number,max:number)=>z.string().trim().min(min).max(max).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const service=z.enum(['VISA','INSURANCE','HOLIDAY','CRUISE']);
const draft=z.object({service,destination:text(2,150),travelWindow:text(2,120),adults:z.number().int().min(0).max(50),childAges:z.array(z.number().int().min(0).max(17)).max(20),
  departureCity:text(2,120).optional(),travelStart:day.optional(),travelEnd:day.optional(),durationNights:z.number().int().min(1).max(365).optional(),nationality:text(2,80).optional(),countryOfResidence:text(2,80).optional(),purpose:text(2,120).optional(),travellerAges:z.array(z.number().int().min(0).max(100)).max(70).optional(),budgetRupees:z.number().positive().max(100000000).optional(),budgetBasis:z.enum(['TOTAL','PER_PERSON']).optional(),cabinPreference:text(2,120).optional(),notes:text(2,800).optional()}).strict();
const contact=z.object({name:text(2,120),email:z.string().email().max(254).optional(),phone:z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),preferredChannel:z.enum(['EMAIL','PHONE','WHATSAPP'])}).strict().refine(value=>value.preferredChannel==='EMAIL'?Boolean(value.email):Boolean(value.phone));
export const platformEnquirySchema=z.object({schemaVersion:z.literal(1),eventId:z.string().uuid(),eventType:z.literal('enquiry.created'),aggregateId:z.string().uuid(),occurredAt:z.iso.datetime(),revision:z.literal(1),
  payload:z.object({enquiryId:z.string().uuid(),reference:z.string().regex(/^ME-[A-F0-9]{12}$/),service,draft,contact,contactVerified:z.literal(false),consentAt:z.iso.datetime(),createdAt:z.iso.datetime()}).strict()}).strict().superRefine((event,ctx)=>{
    if(event.aggregateId!==event.payload.enquiryId||event.payload.service!==event.payload.draft.service)ctx.addIssue({code:'custom',message:'Enquiry identity mismatch.'});
    const d=event.payload.draft;
    if(d.adults+d.childAges.length<1)ctx.addIssue({code:'custom',message:'At least one traveller is required.'});
    if(d.service==='VISA'&&(!d.nationality||!d.purpose)||d.service==='HOLIDAY'&&!d.departureCity)ctx.addIssue({code:'custom',message:'Required service details missing.'});
    if(d.travelEnd&&(!d.travelStart||d.travelEnd<d.travelStart))ctx.addIssue({code:'custom',message:'Invalid travel dates.'});
    if((d.budgetRupees!==undefined)!==(d.budgetBasis!==undefined))ctx.addIssue({code:'custom',message:'Budget basis required.'});
    if(d.service==='INSURANCE'&&(!d.travellerAges||d.travellerAges.filter(age=>age>=18).length!==d.adults||JSON.stringify(d.travellerAges.filter(age=>age<18).sort((a,b)=>a-b))!==JSON.stringify([...d.childAges].sort((a,b)=>a-b))))ctx.addIssue({code:'custom',message:'Insurance traveller ages must match the party.'});
  });

/** Called only AFTER the shared booking endpoint verifies the signed raw body. */
export async function receivePlatformEnquiry(value:unknown,raw:string,eventId:string){
  const event=platformEnquirySchema.parse(value);
  if(event.eventId!==eventId)throw new ApiError(400,'Event identity mismatch.');
  const hash=createHash('sha256').update(raw).digest('hex'),p=event.payload;
  const leadId='maxai-enquiry-'+p.enquiryId,customerId='maxai-contact-'+p.enquiryId;
  return prisma.$transaction(async tx=>{
    const prior=await tx.platformEvent.findUnique({where:{id:eventId}});
    if(prior&&prior.bodyHash!==hash)throw new ApiError(409,'Event identifier collision.');
    const existing=await tx.salesLead.findUnique({where:{id:leadId},include:{serviceCase:true}});
    if(existing){
      if(!existing.serviceCase)throw new ApiError(409,'The imported enquiry needs staff review.');
      if(!prior)throw new ApiError(409,'This immutable enquiry already has a different event identity.');
      return {accepted:true as const,enquiryId:p.enquiryId,crmReference:existing.serviceCase.caseNo,leadId};
    }
    if(prior)throw new ApiError(409,'The imported enquiry record is unavailable.');
    const ownerId=process.env.BOOKING_PLATFORM_OWNER_ID,branchId=process.env.BOOKING_PLATFORM_BRANCH_ID;
    if(!ownerId||!branchId)throw new ApiError(503,'Integration owner and branch are not configured.');
    const owner=await tx.user.findUnique({where:{id:ownerId},include:{role:true}});
    if(!owner?.active||!roleCanOwnCase(owner.role.key)||!(await tx.branch.findUnique({where:{id:branchId}})))throw new ApiError(503,'Integration owner or branch unavailable.');
    // Unverified customer-supplied contacts MUST NOT find/update an existing
    // customer by email/phone. Each enquiry gets a separate provisional contact.
    await tx.customer.create({data:{id:customerId,code:await nextReference(tx,'C'),name:p.contact.name,type:'INDIVIDUAL',status:'LEAD',email:p.contact.email??null,phone:p.contact.phone??'',city:p.draft.departureCity??'',branchId,assignedToId:ownerId}});
    const title=`Max AI ${p.service.toLowerCase()} · ${p.reference}`;
    const journey=await createServiceCase(tx,{customerId,branchId,ownerId,service:p.service,title},ownerId,{preserveAssignedOwner:true,planningTask:false});
    const notes=[`Website enquiry ${p.reference}. Customer explicitly requested contact by ${p.contact.preferredChannel}.`,
      'Contact details are customer-provided and UNVERIFIED. Confirm the contact before quoting or linking another customer. No booking, visa application, policy or payment was created.',
      `Consent recorded: ${p.consentAt}`,...Object.entries(p.draft).filter(([key])=>!['service','budgetRupees','budgetBasis'].includes(key)).map(([key,value])=>`${key}: ${typeof value==='string'?value:JSON.stringify(value)}`)].join('\n');
    const totalBudget=p.draft.budgetBasis==='TOTAL'?Math.round((p.draft.budgetRupees??0)*100):0;
    await tx.salesLead.create({data:{id:leadId,customerId,serviceCaseId:journey.id,branchId,ownerId,title,source:'MAX_AI_WEBSITE',product:p.service,stage:'NEW',destination:p.draft.destination,travelDate:p.draft.travelStart?new Date(p.draft.travelStart+'T00:00:00Z'):null,followUpAt:journey.nextFollowUpAt,budgetMinor:totalBudget<=2000000000?totalBudget:0,requestedBudgetJson:p.draft.budgetRupees!==undefined?JSON.stringify({amountRupees:p.draft.budgetRupees,basis:p.draft.budgetBasis}):null,notes}});
    await tx.serviceCaseEvent.create({data:{caseId:journey.id,actorId:ownerId,kind:'ENQUIRY_RECEIVED',summary:`Max AI enquiry ${p.reference}; contact unverified.`}});
    await tx.auditLog.create({data:{userId:ownerId,action:'PLATFORM_ENQUIRY',entity:'SalesLead',entityId:leadId,detail:p.reference}});
    await tx.platformEvent.create({data:{id:eventId,bodyHash:hash,aggregateId:p.enquiryId}});
    return {accepted:true as const,enquiryId:p.enquiryId,crmReference:journey.caseNo,leadId};
  });
}
