import {ROLE_PERMISSIONS,type RoleKey} from "./permissions";
import {salesRecoveryContext} from "./sales-recovery-context";
import {createHash,createHmac,randomUUID} from "node:crypto";
import type {Prisma,PrismaClient} from "@prisma/client";
import {z} from "zod";
import {ApiError,canTouchRecord} from "./guard";
import type {SessionUser} from "./session";
import {seal,unseal} from "./staff-security";
import {encryptionConfigured} from "./sensitive-encryption";
import {customerCoreSchema,customerProfileSchema,travellerCoreSchema,travellerProfileSchema,loyaltySchema,identitySchema,type ProfileValues} from "./master-validation";
import {travellerMasterFields} from "./master-fields";
import {transactionAudit} from "./transactions";
type Db=Prisma.TransactionClient|PrismaClient;
const include={assignedTo:{select:{id:true,name:true}},branch:{select:{id:true,name:true}},travellers:{include:{loyaltyMemberships:{orderBy:{createdAt:"asc" as const}},identityDocuments:{orderBy:{createdAt:"asc" as const}}},orderBy:{createdAt:"asc" as const}},documents:{select:{id:true,docNo:true,docType:true,travellerId:true,status:true,expiryDate:true,uploadedAt:true,version:true,sensitive:true},orderBy:{createdAt:"desc" as const}}} satisfies Prisma.CustomerInclude;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize=(v:string)=>v.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
const hint=(v:string)=>"******"+(v.length>4?v.slice(-4):"");
export function masterLookup(value:string){if(!encryptionConfigured())throw new ApiError(503,"Secure profile storage is not configured.");return createHmac("sha256",Buffer.from(process.env.CRM_DATA_ENCRYPTION_KEY!,"hex")).update("master:"+value.replace(/\s/g,"").toUpperCase()).digest("hex");}
function unpack(raw:string|null,context:string):ProfileValues {if(!raw)return {};try{const values=JSON.parse(unseal(raw,context));if(context.startsWith("customer-master:")&&values.contactMethod&&!new Set(["EMAIL","CALL"]).has(values.contactMethod))values.contactMethod="EMAIL";return values;}catch{throw new ApiError(503,"This saved profile needs its original encryption key. Contact your operator; do not overwrite it.");}}
async function customer(db:Db,user:SessionUser,id:string){const c=await db.customer.findUnique({where:{id},include});if(!c||!canTouchRecord(user,c))throw new ApiError(404,"Customer master unavailable.");if(c.mergedIntoId)throw new ApiError(409,"This customer was consolidated. Open the retained master.");return c;}
type Loaded=Awaited<ReturnType<typeof customer>>;
function revision(c:Loaded){return hash(c);}
function changedFields(before:object,after:object){const old=before as Record<string,unknown>,next=after as Record<string,unknown>;return Object.keys(next).filter(k=>{let a=old[k];const b=next[k];if(a instanceof Date)a=a.toISOString().slice(0,10);return JSON.stringify(a??"")!==JSON.stringify(b??"");});}

export const masterEnvelope=z.object({action:z.enum(["CUSTOMER","ASSIGN","TRAVELLER","CREATE_TRAVELLER","LOYALTY","REMOVE_LOYALTY","IDENTITY","REMOVE_IDENTITY"]),requestKey:z.uuid(),baseRevision:z.string().regex(/^[a-f0-9]{64}$/),travellerId:z.string().max(200).optional(),rowId:z.string().max(200).optional(),data:z.unknown().optional()}).strict();
export async function readMaster(db:Db,user:SessionUser,id:string,auditAccess=false){
 permission(user,"customer:view");
 const c=await customer(db,user,id),sensitive=user.permissions.includes("sensitive:view"),canTravellers=user.permissions.includes("traveller:view"),canDocuments=user.permissions.includes("document:view");
 if(auditAccess&&sensitive&&canTravellers&&c.travellers.some(t=>t.passportNumber||t.knownTravellerNumber||t.frequentFlyer||t.profileData||t.loyaltyMemberships.length||t.identityDocuments.length))await db.auditLog.create({data:{userId:user.id,action:"MASTER_VIEW",entity:"Customer",entityId:id,detail:JSON.stringify({customerId:id,fields:["protectedTravellerProfile"]})}});
 const personIds=canTravellers?c.travellers.map(t=>t.id):[];
 const auditWhere:Prisma.AuditLogWhereInput={OR:[{action:{startsWith:"MASTER_"},detail:{contains:'"customerId":'+JSON.stringify(id)}},{entity:"Customer",entityId:id},...(personIds.length?[{entity:"Traveller",entityId:{in:personIds}},{entity:"TravellerLoyaltyMembership",entityId:{in:c.travellers.flatMap(t=>t.loyaltyMemberships.map(x=>x.id))}},{entity:"TravellerIdentityDocument",entityId:{in:c.travellers.flatMap(t=>t.identityDocuments.map(x=>x.id))}}]:[]),...(canDocuments?[{entity:"Document",entityId:{in:c.documents.map(d=>d.id)}}]:[])]};
 const canAssign=user.permissions.includes("customer:edit")&&["OWNER","SUPER_ADMIN","BRANCH_MANAGER"].includes(user.role);
 const managers=canAssign?(await db.user.findMany({where:{active:true,branchId:c.branchId},select:{id:true,name:true,role:{select:{key:true,name:true}}},orderBy:{name:"asc"}})).filter(person=>ROLE_PERMISSIONS[person.role.key as RoleKey]?.includes("customer:view")).map(person=>({id:person.id,name:person.name,role:person.role.name})):[];
 const audit=await db.auditLog.findMany({where:auditWhere,include:{user:{select:{name:true}}},orderBy:{at:"desc"},take:100});
 return {managers,actorContext:user.sessionId?salesRecoveryContext(user):null,revision:revision(c),encryptionReady:encryptionConfigured(),customer:{relationshipManager:c.assignedTo,branch:c.branch.name,id:c.id,code:c.code,name:c.name,type:c.type,phone:c.phone,email:c.email??"",city:c.city,address:c.address??"",companyName:c.companyName??"",gstNumber:c.gstNumber??"",status:c.status,details:unpack(c.profileData,"customer-master:"+c.id)},
 travellers:canTravellers?c.travellers.map(t=>{const details=unpack(t.profileData,"traveller-master:"+t.id);if(!sensitive)for(const f of travellerMasterFields.flatMap(g=>g.fields).filter(f=>f.private))delete details[f.key];return {id:t.id,fullName:t.fullName,relation:t.relation,dateOfBirth:t.dateOfBirth?.toISOString().slice(0,10)??"",gender:t.gender??"",nationality:t.nationality,primary:t.primary,knownTravellerNumber:sensitive?t.knownTravellerNumber??"":"",details,legacyFrequentFlyer:t.frequentFlyer?(sensitive?t.frequentFlyer:hint(t.frequentFlyer)):null,
 legacyPassport:t.passportNumber?{number:sensitive?t.passportNumber:null,numberHint:hint(t.passportNumber),issueDate:t.passportIssueDate?.toISOString().slice(0,10)??"",expiryDate:t.passportExpiry?.toISOString().slice(0,10)??"",placeOfIssue:t.passportPlace??""}:null,
 memberships:t.loyaltyMemberships.map(m=>({id:m.id,category:m.category,providerName:m.providerName,programName:m.programName,carrierCodes:JSON.parse(m.carrierCodes) as string[],memberNumber:sensitive?unseal(m.memberNumber,"loyalty:"+m.id):null,numberHint:hint(unseal(m.memberNumber,"loyalty:"+m.id)),memberName:m.memberName??"",tier:m.tier??"",expiryDate:m.expiryDate??"",preferred:m.preferred})),
 identities:t.identityDocuments.map(d=>({id:d.id,kind:d.kind,documentNumber:sensitive?unseal(d.documentNumber,"identity:"+d.id):null,numberHint:hint(unseal(d.documentNumber,"identity:"+d.id)),issuingCountry:d.issuingCountry,nationality:d.nationality??"",issueDate:d.issueDate??"",expiryDate:d.expiryDate??"",placeOfIssue:d.placeOfIssue??"",visaType:d.visaType??"",entries:d.entries??"",primaryPassport:d.primaryPassport,fileDocumentId:d.fileDocumentId}))};}):[],
 documents:canDocuments?c.documents.map(d=>({...d,expiryDate:d.expiryDate?.toISOString().slice(0,10)??"",uploadedAt:d.uploadedAt?.toISOString()??null})):[],
 audit:audit.map(a=>({id:a.id,at:a.at.toISOString(),actor:a.user?.name??"System / former staff",travellerName:canTravellers?(()=>{try{return c.travellers.find(t=>t.id===JSON.parse(a.detail??"{}").travellerId)?.fullName??null;}catch{return null;}})():null,action:a.action,entity:a.entity,fields:a.action.startsWith("MASTER_")?(()=>{try{return (JSON.parse(a.detail??"{}").fields??[]) as string[];}catch{return [];}})():[]})),
 permissions:{email:user.permissions.includes("email:send"),assign:canAssign,viewTravellers:canTravellers,viewDocuments:canDocuments,customer:user.permissions.includes("customer:edit"),traveller:user.permissions.includes("traveller:edit"),createTraveller:user.permissions.includes("traveller:create"),upload:user.permissions.includes("document:upload"),sensitive,export:user.permissions.includes("export:data")}};
}
export type CustomerMasterData=Awaited<ReturnType<typeof readMaster>>;
function permission(user:SessionUser,value:string){if(!user.permissions.includes(value as never))throw new ApiError(403,"You do not have permission for this master action.");}
function secure(){if(!encryptionConfigured())throw new ApiError(503,"Secure profile storage must be configured before saving private traveller profiles.");}
export async function mutateMaster(db:PrismaClient,user:SessionUser,id:string,input:unknown){const b=masterEnvelope.parse(input),bodyHash=hash(b);permission(user,["CUSTOMER","ASSIGN"].includes(b.action)?"customer:edit":b.action==="CREATE_TRAVELLER"?"traveller:create":"traveller:edit");secure();return db.$transaction(async tx=>{
 const c=await customer(tx,user,id);
 const needed=["CUSTOMER","ASSIGN"].includes(b.action)?"customer:edit":b.action==="CREATE_TRAVELLER"?"traveller:create":"traveller:edit";permission(user,needed);secure();
 const previous=await tx.masterMutation.findUnique({where:{actorId_requestKey:{actorId:user.id,requestKey:b.requestKey}}});
 if(previous){if(previous.customerId!==id||previous.bodyHash!==bodyHash)throw new ApiError(409,"This save reference belongs to different changes.");return {...JSON.parse(previous.result),replayed:true};}
 if(revision(c)!==b.baseRevision)throw new ApiError(409,"This master changed after you opened it. Reload the latest profile before saving; your draft has been kept.");
 let entity="Customer",entityId=id,fields:string[]=[];
 if(b.action==="ASSIGN"){
  if(!["OWNER","SUPER_ADMIN","BRANCH_MANAGER"].includes(user.role))throw new ApiError(403,"Only an agency or branch administrator can assign a relationship manager.");
  const data=z.object({assignedToId:z.string().min(1).max(200)}).strict().parse(b.data),manager=await tx.user.findUnique({where:{id:data.assignedToId},include:{role:{select:{key:true}}}});
  if(!manager?.active||manager.branchId!==c.branchId||!ROLE_PERMISSIONS[manager.role.key as RoleKey]?.includes("customer:view"))throw new ApiError(400,"Choose an active customer manager in this customer's branch.");
  await tx.customer.update({where:{id},data:{assignedToId:manager.id}});fields=changedFields(c,data);
 }else if(b.action==="CUSTOMER"){
  const data=z.object({core:customerCoreSchema,details:customerProfileSchema}).strict().parse(b.data);
  const previousDetails=unpack(c.profileData,"customer-master:"+id),details={...previousDetails,...data.details};
  if(data.core.type!=="INDIVIDUAL"&&!data.core.companyName)throw new ApiError(400,"Enter the company or agency name.");
  const changes={...data.core,email:data.core.email||null,companyName:data.core.companyName||null,gstNumber:data.core.gstNumber||null,profileData:seal(JSON.stringify(details),"customer-master:"+id)};
  fields=[...changedFields(c,data.core),...changedFields(previousDetails,data.details).map(k=>"profile."+k)];
  await tx.customer.update({where:{id},data:changes});
 }else{
  const t=b.action==="CREATE_TRAVELLER"?null:c.travellers.find(t=>t.id===b.travellerId);
  if(b.action!=="CREATE_TRAVELLER"&&!t)throw new ApiError(404,"Traveller does not belong to this customer master.");
  if(b.action==="TRAVELLER"||b.action==="CREATE_TRAVELLER"){
   const data=z.object({core:travellerCoreSchema,details:travellerProfileSchema}).strict().parse(b.data);
   if(data.core.dateOfBirth&&data.core.dateOfBirth>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date()))throw new ApiError(400,"Date of birth cannot be in the future.");
   if(!user.permissions.includes("sensitive:view")&&(data.core.knownTravellerNumber!==undefined||Object.keys(data.details).some(k=>travellerMasterFields.flatMap(g=>g.fields).some(f=>f.key===k&&f.private))))throw new ApiError(403,"Editing restricted traveller identifiers or assistance notes needs sensitive-data permission.");
   const tid=t?.id??randomUUID(),previousDetails=unpack(t?.profileData??null,"traveller-master:"+tid),details={...previousDetails,...data.details};
   if((details.givenNames||details.surname)&&normalize([details.givenNames,details.surname].filter(Boolean).join(" "))!==normalize(data.core.fullName))throw new ApiError(400,"Full name must match the given names and surname entered for the travel ID.");
   if(data.core.primary)await tx.traveller.updateMany({where:{customerId:id,primary:true,id:{not:tid}},data:{primary:false}});
   const changes={...data.core,...(!t&&data.core.primary===undefined?{primary:c.travellers.length===0}:{}),...(data.core.knownTravellerNumber!==undefined?{knownTravellerNumber:data.core.knownTravellerNumber||null}:{}),dateOfBirth:data.core.dateOfBirth?new Date(data.core.dateOfBirth+"T00:00:00Z"):null,profileData:seal(JSON.stringify(details),"traveller-master:"+tid)};
   if(t)await tx.traveller.update({where:{id:tid},data:changes});else await tx.traveller.create({data:{...changes,id:tid,customerId:id}});
   entity="Traveller";entityId=tid;fields=[...changedFields(t??{},data.core),...changedFields(previousDetails,data.details).map(k=>"profile."+k)];
  }else if(b.action==="LOYALTY"){
   const data=loyaltySchema.parse(b.data),old=b.rowId?t!.loyaltyMemberships.find(m=>m.id===b.rowId):null;
   if(b.rowId&&!old)throw new ApiError(404,"Membership is outside this traveller profile.");
   const mid=old?.id??randomUUID();let number=data.memberNumber;
   if(number&&!user.permissions.includes("sensitive:view"))throw new ApiError(403,"Entering a membership number needs sensitive-data permission.");
   if(!number&&old)number=unseal(old.memberNumber,"loyalty:"+old.id);
   if(!number)throw new ApiError(400,"Enter the membership number.");
   const programKey=JSON.stringify([data.category,normalize(data.providerName),normalize(data.programName)]);
   const lookup=masterLookup(number),duplicate=await tx.travellerLoyaltyMembership.findFirst({where:{travellerId:t!.id,programKey,numberLookup:lookup,id:{not:mid}}});if(duplicate)throw new ApiError(409,"This membership is already saved for this traveller and program.");
   if(data.preferred)await tx.travellerLoyaltyMembership.updateMany({where:{travellerId:t!.id,programKey,preferred:true,id:{not:mid}},data:{preferred:false}});
   const changes={...data,programKey,carrierCodes:JSON.stringify([...new Set(data.carrierCodes)]),memberNumber:seal(number,"loyalty:"+mid),numberLookup:lookup};
   if(old)await tx.travellerLoyaltyMembership.update({where:{id:mid},data:changes});else await tx.travellerLoyaltyMembership.create({data:{...changes,id:mid,travellerId:t!.id}});
   entity="TravellerLoyaltyMembership";entityId=mid;fields=changedFields(old?{...old,carrierCodes:JSON.parse(old.carrierCodes),memberNumber:unseal(old.memberNumber,"loyalty:"+old.id)}:{},{...data,memberNumber:number,carrierCodes:[...new Set(data.carrierCodes)]});
  }else if(b.action==="REMOVE_LOYALTY"){
   const old=t!.loyaltyMemberships.find(m=>m.id===b.rowId);if(!old)throw new ApiError(404,"Membership unavailable.");await tx.travellerLoyaltyMembership.delete({where:{id:old.id}});entity="Traveller";entityId=t!.id;fields=["loyaltyMembership.removed"];
  }else if(b.action==="IDENTITY"){
   permission(user,"sensitive:view");const data=identitySchema.parse(b.data),old=b.rowId?t!.identityDocuments.find(d=>d.id===b.rowId):null;if(b.rowId&&!old)throw new ApiError(404,"Travel document is outside this traveller profile.");
   const did=old?.id??randomUUID(),number=data.documentNumber|| (old?unseal(old.documentNumber,"identity:"+old.id):"");if(!number)throw new ApiError(400,"Enter the travel document number.");
   if(data.fileDocumentId!==(old?.fileDocumentId??null)&&(data.fileDocumentId||old?.fileDocumentId))permission(user,"document:view");
   if(data.fileDocumentId&&!c.documents.some(d=>d.id===data.fileDocumentId&&d.travellerId===t!.id))throw new ApiError(400,"Choose a file belonging to this traveller and customer.");
   const lookup=masterLookup(number);if(await tx.travellerIdentityDocument.findFirst({where:{travellerId:t!.id,kind:data.kind,issuingCountry:data.issuingCountry,numberLookup:lookup,id:{not:did}}}))throw new ApiError(409,"This travel document is already saved.");
   if(data.primaryPassport){await tx.travellerIdentityDocument.updateMany({where:{travellerId:t!.id,primaryPassport:true,id:{not:did}},data:{primaryPassport:false}});await tx.traveller.update({where:{id:t!.id},data:{passportNumber:number,passportIssueDate:data.issueDate?new Date(data.issueDate+"T00:00:00Z"):null,passportExpiry:data.expiryDate?new Date(data.expiryDate+"T00:00:00Z"):null,passportPlace:data.placeOfIssue||null}});}
   if(old?.primaryPassport&&!data.primaryPassport)throw new ApiError(400,"Choose another primary passport before clearing the current selection.");
   const changes={...data,documentNumber:seal(number,"identity:"+did),numberLookup:lookup};
   if(old)await tx.travellerIdentityDocument.update({where:{id:did},data:changes});else await tx.travellerIdentityDocument.create({data:{...changes,id:did,travellerId:t!.id}});
   entity="TravellerIdentityDocument";entityId=did;fields=changedFields(old?{...old,documentNumber:unseal(old.documentNumber,"identity:"+old.id)}:{},{...data,documentNumber:number});
  }else if(b.action==="REMOVE_IDENTITY"){
   permission(user,"sensitive:view");const old=t!.identityDocuments.find(d=>d.id===b.rowId);if(!old)throw new ApiError(404,"Travel document unavailable.");if(old.primaryPassport)await tx.traveller.update({where:{id:t!.id},data:{passportNumber:null,passportLookup:null,passportIssueDate:null,passportExpiry:null,passportPlace:null}});await tx.travellerIdentityDocument.delete({where:{id:old.id}});entity="Traveller";entityId=t!.id;fields=["identityDocument.removed"];
  }
 }
 await transactionAudit(tx,user,"MASTER_"+b.action,entity,entityId,JSON.stringify({customerId:id,reference:c.code,travellerId:b.action==="CREATE_TRAVELLER"?entityId:b.travellerId,fields}));
 await tx.activity.create({data:{customerId:id,actorId:user.id,type:"EDIT",summary:"Customer master updated: "+b.action.toLowerCase().replaceAll("_"," "),link:"/masters/"+id}});
 const result={ok:true,entity,entityId};await tx.masterMutation.create({data:{actorId:user.id,requestKey:b.requestKey,bodyHash,customerId:id,result:JSON.stringify(result)}});return result;
 },{timeout:20000});}
export async function loyaltyForFlight(db:Db,user:SessionUser,customerId:string,travellerId:string,carrier:string,travelDate:string){const c=await customer(db,user,customerId);permission(user,"traveller:view");const t=c.travellers.find(t=>t.id===travellerId);if(!t)throw new ApiError(404,"Traveller unavailable.");return t.loyaltyMemberships.filter(m=>m.category==="AIRLINE"&&(!m.expiryDate||m.expiryDate>=travelDate)&&(JSON.parse(m.carrierCodes) as string[]).includes(carrier.toUpperCase())).map(m=>({id:m.id,programName:m.programName,numberHint:hint(unseal(m.memberNumber,"loyalty:"+m.id)),preferred:m.preferred}));}

/** New tax-invoice snapshots use explicit billing details; historical snapshots stay unchanged. */
export function masterBilling(c:{id:string;name:string;companyName:string|null;address:string|null;city:string;gstNumber:string|null;profileData?:string|null}){const d=unpack(c.profileData??null,"customer-master:"+c.id);return {name:d.billingName||c.name,companyName:c.companyName,gstin:c.gstNumber,address:[d.billingAddress||c.address,d.billingPostalCode,d.billingCountry].filter(Boolean).join(", ")||null,city:d.billingCity||c.city,state:d.billingState||d.state||""};}

/** Re-seal moved customer fields with the retained customer's context; never copy AAD-bound ciphertext. */
export function mergedMasterProfile(source:{id:string;profileData:string|null},target:{id:string;profileData:string|null}){if(!source.profileData)return target.profileData;secure();const from=unpack(source.profileData,"customer-master:"+source.id),to=unpack(target.profileData,"customer-master:"+target.id);const conflicts=Object.keys(from).filter(k=>from[k]&&to[k]&&from[k]!==to[k]);if(conflicts.length)throw new ApiError(409,"These masters have different profile details. Review and reconcile their contact/billing/preferences before consolidating.");const merged={...to};for(const[k,v]of Object.entries(from))if(v&&!merged[k])merged[k]=v;return seal(JSON.stringify(merged),"customer-master:"+target.id);}
