import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Prisma,PrismaClient} from '@prisma/client';
import type {SessionUser} from './session';
import {ApiError} from './guard';
import {seal,unseal} from './staff-security';
import {encryptionConfigured} from './sensitive-encryption';
import {CASE_SERVICES,CASE_STATUSES,createServiceCase,roleCanOwnCase} from './service-cases';
import {nextReference,transactionAudit} from './transactions';
import {ROLE_ACCESS,ROLE_PERMISSIONS,type RoleKey} from './permissions';

type Tx=Prisma.TransactionClient;
const text=(max=200)=>z.string().trim().max(max).default('');
const ref=z.string().trim().min(1).max(100);
const clientSchema=z.object({externalId:ref,name:z.string().trim().min(1).max(150),phone:z.string().trim().min(1).max(40),email:text(254),city:text(150),address:text(1000),type:text(30),companyName:text(200),gstNumber:text(30),crmClientCode:text(100)}).strict();
const caseSchema=z.object({externalId:ref,clientRef:ref,service:z.enum(CASE_SERVICES),title:z.string().trim().min(3).max(200),status:z.enum(CASE_STATUSES).default('OPEN'),openedOn:z.string().min(1).max(10),legacyReference:text(100),legacyStage:text(150),ownerEmail:text(254),nextFollowUpAt:text(25),nextAction:text(200),notes:text(2000)}).strict();
const travellerSchema=z.object({externalId:ref,clientRef:ref,name:z.string().trim().min(1).max(200),relation:text(30),dateOfBirth:text(10),nationality:text(80),passportNumber:text(30),passportExpiry:text(10)}).strict();
const rawRow=z.record(z.string().max(100),z.string().max(4000));
export const importDraftSchema=z.object({requestKey:z.string().uuid(),source:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/),branchId:z.string().min(1).max(200),ownerId:z.string().min(1).max(200),clients:z.array(rawRow).max(200).default([]),cases:z.array(rawRow).max(200).default([]),travellers:z.array(rawRow).max(200).default([]),clientLinks:z.record(z.string().max(100),z.string().max(200)).default({})}).strict();
export type ImportDraft=z.infer<typeof importDraftSchema>;
type Client=z.infer<typeof clientSchema>;
type Case=z.infer<typeof caseSchema>;
type Traveller=z.infer<typeof travellerSchema>;
type Canonical=Omit<ImportDraft,'clients'|'cases'|'travellers'>&{clients:Client[];cases:Case[];travellers:Traveller[]};
export type ImportIssue={entity:string;row:number;field:string;message:string};
export type ImportPlanRow={entity:string;row:number;externalId:string;label:string;action:'create'|'reuse'|'link';targetId?:string;contactConflict?:boolean;candidates?:{id:string;code:string;name:string}[]};
export type ImportPlan={rows:ImportPlanRow[];issues:ImportIssue[];counts:{create:number;reuse:number;link:number};planHash:string};
type SavedRecord={entity:'CLIENT'|'TRAVELLER'|'CASE';id:string;hash:string};
export type ImportResult={clients:number;cases:number;travellers:number;reused:number;linked:number;records:SavedRecord[];caseLinks:{id:string;caseNo:string;legacyReference:string|null}[]};
const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'&&!(v instanceof Date)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
export const importHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const today=()=>new Date(Date.now()+19800000).toISOString().slice(0,10);
export function importPhone(value:string){let n=value.replace(/^'/,'').replace(/[\s()+.-]/g,'');if(/^[6-9]\d{9}$/.test(n))n='91'+n;if(!/^[1-9]\d{9,14}$/.test(n))throw Error('Use a valid phone number with its country code. Indian 10-digit numbers are accepted.');return '+'+n;}
export function importDate(value:string,label:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1900||Number(value.slice(0,4))>2100)throw Error(`${label}: use YYYY-MM-DD.`);const date=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw Error(`${label}: use a real calendar date.`);return date;}
function followUp(value:string){if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Follow-up: use YYYY-MM-DDTHH:mm in India time.');importDate(value.slice(0,10),'Follow-up');const hour=Number(value.slice(11,13)),minute=Number(value.slice(14,16));if(hour>23||minute>59)throw Error('Follow-up time is invalid.');return new Date(value+':00+05:30');}
export function assertImportAccess(user:SessionUser){if(!['OWNER','SUPER_ADMIN'].includes(user.role)||!user.permissions.includes('settings:manage'))throw new ApiError(403,'Only the agency owner or super administrator can manage imports.');}
function normalize(draft:ImportDraft){
 const issues:ImportIssue[]=[];
 const read=<T>(entity:string,rows:Record<string,string>[],schema:z.ZodType<T>,validate:(v:T)=>void):T[]=>rows.flatMap((raw,index)=>{
  const parsed=schema.safeParse(Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v===''?undefined:v])));
  if(!parsed.success){for(const issue of parsed.error.issues)issues.push({entity,row:index+2,field:String(issue.path[0]??'row'),message:'Check this field and its permitted values.'});return[];}
  try{validate(parsed.data);return[parsed.data];}catch(e){issues.push({entity,row:index+2,field:'row',message:e instanceof Error?e.message:'Check this row.'});return[];}
 });
 const clients=read('clients',draft.clients,clientSchema,c=>{c.phone=importPhone(c.phone);c.email=c.email.toLowerCase();if(c.email&&!z.email().safeParse(c.email).success)throw Error('Enter a valid email.');c.type=c.type.toUpperCase()||'INDIVIDUAL';if(!['INDIVIDUAL','CORPORATE','SUB_AGENT'].includes(c.type))throw Error('Use INDIVIDUAL, CORPORATE or SUB_AGENT.');});
 const cases=read('cases',draft.cases,caseSchema,c=>{importDate(c.openedOn,'Opened date');if(c.openedOn>today())throw Error('The original case opening date cannot be in the future.');followUp(c.nextFollowUpAt);c.ownerEmail=c.ownerEmail.toLowerCase();});
 const travellers=read('travellers',draft.travellers,travellerSchema,t=>{t.relation=t.relation.toUpperCase()||'SELF';if(!['SELF','SPOUSE','SON','DAUGHTER','FATHER','MOTHER','SIBLING','EMPLOYEE','GROUP','OTHER'].includes(t.relation))throw Error('Choose a supported traveller relationship.');if(t.dateOfBirth){importDate(t.dateOfBirth,'Date of birth');if(t.dateOfBirth>today())throw Error('Date of birth cannot be in the future.');}if(t.passportExpiry)importDate(t.passportExpiry,'Passport expiry');t.passportNumber=t.passportNumber.replace(/\s/g,'').toUpperCase();if(t.passportNumber&&!/^[A-Z0-9-]{3,30}$/.test(t.passportNumber))throw Error('Check the passport number.');});
 for(const [entity,rows]of Object.entries({clients:draft.clients,cases:draft.cases,travellers:draft.travellers})){const seen=new Set<string>();rows.forEach((r,i)=>{if(seen.has(r.externalId))issues.push({entity,row:i+2,field:'externalId',message:'Reference occurs more than once in this file.'});seen.add(r.externalId);});}
 if(!draft.clients.length&&!draft.cases.length&&!draft.travellers.length)issues.push({entity:'batch',row:0,field:'file',message:'Upload at least one file.'});
 const self=new Set<string>();travellers.forEach((t,i)=>{if(t.relation==='SELF'){if(self.has(t.clientRef))issues.push({entity:'travellers',row:i+2,field:'relation',message:'A client can have only one imported SELF traveller.'});self.add(t.clientRef);}});
 return{data:{...draft,source:draft.source.trim().toLowerCase(),clients,cases,travellers} as Canonical,issues};
}
const identity=(source:string,entity:string,externalId:string)=>({source_entity_externalId:{source,entity,externalId}});
function clientSnapshot(c:{name:string;phone:string;email:string|null;city:string;address:string|null;type:string;companyName:string|null;gstNumber:string|null;branchId:string;assignedToId:string|null;whatsappOptIn:boolean}){const{name,phone,email,city,address,type,companyName,gstNumber,branchId,assignedToId,whatsappOptIn}=c;return{name,phone,email,city,address,type,companyName,gstNumber,branchId,assignedToId,whatsappOptIn};}
function travellerSnapshot(t:{customerId:string;fullName:string;relation:string;dateOfBirth:Date|null;nationality:string;passportNumber:string|null;passportExpiry:Date|null;primary:boolean}){const{customerId,fullName,relation,dateOfBirth,nationality,passportNumber,passportExpiry,primary}=t;return{customerId,fullName,relation,dateOfBirth,nationality,passportNumber,passportExpiry,primary};}

export async function planImport(tx:Tx,draft:ImportDraft,user:SessionUser):Promise<{data:Canonical;plan:ImportPlan}>{
 assertImportAccess(user);const{data,issues}=normalize(draft),rows:ImportPlanRow[]=[];
 if(!await tx.branch.findUnique({where:{id:data.branchId}}))throw new ApiError(400,'Choose an existing branch.');
 const owner=await tx.user.findUnique({where:{id:data.ownerId},include:{role:true}});
 if(!owner?.active||!roleCanOwnCase(owner.role.key)||(owner.branchId!==data.branchId&&ROLE_ACCESS[owner.role.key as RoleKey]!=='ALL'))throw new ApiError(400,'Choose an active case owner with access to the selected branch.');
 const contacts=await tx.customer.findMany({where:{branchId:data.branchId,mergedIntoId:null},select:{id:true,code:true,name:true,phone:true,email:true}});
 const refs=new Map<string,string>(),seenContacts=new Map<string,string>();
 for(const c of data.clients){
  const fileRow=draft.clients.findIndex(r=>r.externalId?.trim()===c.externalId)+2;
  const prior=await tx.dataImportIdentity.findUnique({where:identity(data.source,'CLIENT',c.externalId)});
  let target:string|undefined,action:ImportPlanRow['action']='create',contactConflict=false;
  const candidates=contacts.filter(x=>{let phone='';try{phone=importPhone(x.phone);}catch{}return phone===c.phone||Boolean(c.email&&x.email?.toLowerCase()===c.email);}).map(({id,code,name})=>({id,code,name}));
  if(prior){const existing=await tx.customer.findUnique({where:{id:prior.recordId}});if(!existing||existing.mergedIntoId||existing.branchId!==data.branchId)issues.push({entity:'clients',row:fileRow,field:'externalId',message:'The previously linked client is unavailable in this branch.'});if(prior.rowHash!==importHash(c))issues.push({entity:'clients',row:fileRow,field:'externalId',message:'This reference already has different imported details. Review the existing CRM profile; it will not be overwritten.'});target=prior.recordId;action='reuse';}
  else{
   const choice=Object.hasOwn(data.clientLinks,c.externalId)?data.clientLinks[c.externalId]:undefined;
   if(choice==='CREATE_SEPARATE'){/* Explicit owner review of a shared family/corporate contact. */}
   else if(choice||c.crmClientCode){const found=contacts.find(x=>choice?x.id===choice:x.code===c.crmClientCode);if(!found)issues.push({entity:'clients',row:fileRow,field:'crmClientCode',message:'Choose an existing retained client in this branch.'});else{target=found.id;action='link';}}
   else if(candidates.length)issues.push({entity:'clients',row:fileRow,field:'clientLink',message:'Possible existing client. Choose the retained profile or correct the source data.'});
   for(const key of[c.phone,...(c.email?[c.email]:[])]){const previous=seenContacts.get(key);if(previous&&previous!==c.externalId){contactConflict=true;if(choice!=='CREATE_SEPARATE'&&action!=='link')issues.push({entity:'clients',row:fileRow,field:'phone',message:'This contact also occurs in another client row. Review shared/family contacts before importing.'});}seenContacts.set(key,c.externalId);}
  }
  refs.set(c.externalId,target??'new:'+c.externalId);rows.push({entity:'clients',row:fileRow,externalId:c.externalId,label:c.name,action,targetId:target,candidates,contactConflict});
 }
 async function client(ref:string,entity:string,row:number){if(refs.has(ref))return refs.get(ref)!;const mapped=await tx.dataImportIdentity.findUnique({where:identity(data.source,'CLIENT',ref)});const c=mapped?await tx.customer.findUnique({where:{id:mapped.recordId}}):null;if(!c||c.mergedIntoId||c.branchId!==data.branchId){issues.push({entity,row,field:'clientRef',message:'Link this reference to a client in this batch or a previous import from the same source and branch.'});return'';}refs.set(ref,c.id);return c.id;}
 for(const[entity,list]of [['cases',data.cases],['travellers',data.travellers]] as const)for(const row of list){
  const fileRow=draft[entity].findIndex(r=>r.externalId?.trim()===row.externalId)+2;
  const customerId=await client(row.clientRef,entity,fileRow),kind=entity==='cases'?'CASE':'TRAVELLER';
  const previous=await tx.dataImportIdentity.findUnique({where:identity(data.source,kind,row.externalId)});
  if(previous){const record=entity==='cases'?await tx.serviceCase.findUnique({where:{id:previous.recordId}}):await tx.traveller.findUnique({where:{id:previous.recordId}});if(!record||record.customerId!==customerId||previous.rowHash!==importHash(row))issues.push({entity,row:fileRow,field:'externalId',message:'This reference is missing, belongs to another client, or has changed details. Existing records are not overwritten.'});}
  if(entity==='travellers'&&!previous&&(row as Traveller).relation==='SELF'&&!customerId.startsWith('new:')&&customerId&&await tx.traveller.count({where:{customerId,primary:true}}))issues.push({entity,row:fileRow,field:'relation',message:'This client already has a primary traveller. Review that profile before adding another SELF traveller.'});
  if(entity==='cases'){
   const c=row as Case;
   const staff=c.ownerEmail?await tx.user.findUnique({where:{email:c.ownerEmail},include:{role:true}}):owner;
   if(!staff?.active||(staff.branchId!==data.branchId&&ROLE_ACCESS[staff.role.key as RoleKey]!=='ALL')||!roleCanOwnCase(staff.role.key)||!ROLE_PERMISSIONS[staff.role.key as RoleKey]?.includes(c.service==='VISA'?'visa:view':'ticketing:view'))issues.push({entity,row:fileRow,field:'ownerEmail',message:'Choose active staff with access to this service and branch.'});
  }
  rows.push({entity,row:fileRow,externalId:row.externalId,label:'title'in row?row.title:row.name,action:previous?'reuse':'create',targetId:previous?.recordId});
 }
 const counts={create:rows.filter(r=>r.action==='create').length,reuse:rows.filter(r=>r.action==='reuse').length,link:rows.filter(r=>r.action==='link').length};
 return{data,plan:{rows,issues,counts,planHash:importHash({rows,issues,branch:data.branchId,owner:data.ownerId})}};
}

export async function prepareImport(db:PrismaClient,draft:ImportDraft,user:SessionUser){
 assertImportAccess(user);if(!encryptionConfigured())throw new ApiError(503,'Configure the CRM data encryption key before importing private client records.');
 const inputHash=importHash(draft);
 return db.$transaction(async tx=>{
  const prior=await tx.dataImportBatch.findUnique({where:{actorId_requestKey:{actorId:user.id,requestKey:draft.requestKey}}});
  if(prior){if(prior.inputHash!==inputHash)throw new ApiError(409,'Use a fresh preview for changed files or mappings.');if(prior.expiresAt<new Date()||!prior.preview)throw new ApiError(409,'This preview expired. Validate the file again.');return{id:prior.id,status:prior.status,plan:JSON.parse(unseal(prior.preview,'import-preview:'+prior.id)) as ImportPlan};}
  const {plan}=await planImport(tx,draft,user),id=randomUUID();
  await tx.dataImportBatch.create({data:{id,actorId:user.id,requestKey:draft.requestKey,branchId:draft.branchId,source:draft.source.toLowerCase(),status:plan.issues.length?'DRAFT':'READY',inputHash,planHash:plan.planHash,payload:seal(JSON.stringify(draft),'import-payload:'+id),preview:seal(JSON.stringify(plan),'import-preview:'+id),expiresAt:new Date(Date.now()+86400000)}});
  return{id,status:plan.issues.length?'DRAFT':'READY',plan};
 },{timeout:60000});
}

export async function commitImport(db:PrismaClient,id:string,user:SessionUser){
 assertImportAccess(user);
 return db.$transaction(async tx=>{
  const batch=await tx.dataImportBatch.findUnique({where:{id}});if(!batch||batch.actorId!==user.id)throw new ApiError(404,'Import batch unavailable.');
  if(batch.status==='COMMITTED')return{...JSON.parse(batch.result!) as ImportResult,replayed:true};
  if(batch.status!=='READY'||batch.expiresAt<new Date())throw new ApiError(409,'Validate a fresh, error-free preview before importing.');
  const draft=importDraftSchema.parse(JSON.parse(unseal(batch.payload,'import-payload:'+id))),{data,plan}=await planImport(tx,draft,user);
  if(plan.issues.length||plan.planHash!==batch.planHash)throw new ApiError(409,'Records or permissions changed after preview. Validate again before importing.');
  const claimed=await tx.dataImportBatch.updateMany({where:{id,status:'READY'},data:{status:'COMMITTING'}});if(claimed.count!==1)throw new ApiError(409,'This import is already being processed. Check its status.');
  const result:ImportResult={clients:0,cases:0,travellers:0,reused:0,linked:0,records:[],caseLinks:[]},clientIds=new Map<string,string>();
  async function remember(entity:string,externalId:string,recordId:string,row:unknown,linked=false){await tx.dataImportIdentity.create({data:{source:data.source,entity,externalId,recordId,batchId:id,rowHash:importHash(row),linked}});}
  async function clientId(ref:string){const c=clientIds.get(ref)??(await tx.dataImportIdentity.findUniqueOrThrow({where:identity(data.source,'CLIENT',ref)})).recordId;return c;}
  for(const c of data.clients){
   const p=plan.rows.find(r=>r.entity==='clients'&&r.externalId===c.externalId)!;
   if(p.targetId){clientIds.set(c.externalId,p.targetId);if(p.action==='link'){await remember('CLIENT',c.externalId,p.targetId,c,true);result.linked++;}else result.reused++;continue;}
   const client=await tx.customer.create({data:{name:c.name,phone:c.phone,email:c.email||null,city:c.city,address:c.address||null,type:c.type,companyName:c.companyName||null,gstNumber:c.gstNumber||null,code:await nextReference(tx,'C'),branchId:data.branchId,assignedToId:data.ownerId,whatsappOptIn:false}});
   clientIds.set(c.externalId,client.id);await remember('CLIENT',c.externalId,client.id,c);result.clients++;result.records.push({entity:'CLIENT',id:client.id,hash:importHash(clientSnapshot(client))});
   if(!data.travellers.some(t=>t.clientRef===c.externalId&&t.relation==='SELF')){const t=await tx.traveller.create({data:{customerId:client.id,fullName:c.name,relation:'SELF',primary:true}});result.records.push({entity:'TRAVELLER',id:t.id,hash:importHash(travellerSnapshot(t))});}
  }
  for(const t of data.travellers){
   const p=plan.rows.find(r=>r.entity==='travellers'&&r.externalId===t.externalId)!;if(p.action==='reuse'){result.reused++;continue;}
   const cid=await clientId(t.clientRef);if(t.relation==='SELF'&&await tx.traveller.count({where:{customerId:cid,primary:true}}))throw new ApiError(409,'An existing primary traveller needs review; no records were imported.');
   const record=await tx.traveller.create({data:{customerId:cid,fullName:t.name,relation:t.relation,dateOfBirth:t.dateOfBirth?importDate(t.dateOfBirth,'Date of birth'):null,nationality:t.nationality||'India',passportNumber:t.passportNumber||null,passportExpiry:t.passportExpiry?importDate(t.passportExpiry,'Passport expiry'):null,primary:t.relation==='SELF'}});
   await remember('TRAVELLER',t.externalId,record.id,t);result.travellers++;result.records.push({entity:'TRAVELLER',id:record.id,hash:importHash(travellerSnapshot(record))});
  }
  for(const c of data.cases){
   const p=plan.rows.find(r=>r.entity==='cases'&&r.externalId===c.externalId)!;if(p.action==='reuse'){result.reused++;continue;}
   const ownerId=c.ownerEmail?(await tx.user.findUniqueOrThrow({where:{email:c.ownerEmail}})).id:data.ownerId,closed=['COMPLETED','CANCELLED'].includes(c.status);
   const record=await createServiceCase(tx,{customerId:await clientId(c.clientRef),branchId:data.branchId,ownerId,service:c.service,title:c.title},user.id,{preserveAssignedOwner:true,planningTask:!closed});
   const updated=await tx.serviceCase.update({where:{id:record.id},data:{status:c.status,createdAt:importDate(c.openedOn,'Opened date'),legacyReference:c.legacyReference||c.externalId,legacyStage:c.legacyStage||null,importSource:data.source,importedAt:new Date(),nextFollowUpAt:closed?null:followUp(c.nextFollowUpAt)}});
   if(!closed)await tx.task.updateMany({where:{serviceCaseId:record.id},data:{title:c.nextAction||'Review imported '+c.service.toLowerCase()+' case',details:'Review the source record and confirm the next action. Imported status is historical, not new work completion.',ownerId,unassigned:false,dueAt:followUp(c.nextFollowUpAt),requiresReview:ownerId!==user.id,reviewerId:ownerId!==user.id?user.id:null,assignedAt:new Date()}});
   await tx.serviceCaseEvent.create({data:{caseId:record.id,actorId:user.id,kind:'IMPORTED',summary:`Imported operational case from ${data.source}. Original reference: ${c.legacyReference||c.externalId}. Original stage: ${c.legacyStage||c.status}.${c.notes?' Notes: '+c.notes:''} Financial and supplier confirmations require their linked workflows.`}});
   await remember('CASE',c.externalId,record.id,c);result.cases++;result.caseLinks.push({id:record.id,caseNo:record.caseNo,legacyReference:updated.legacyReference});
   result.records.push({entity:'CASE',id:record.id,hash:importHash({...updated,updatedAt:undefined})});
  }
  const now=new Date();await tx.dataImportBatch.update({where:{id},data:{status:'COMMITTED',result:JSON.stringify(result),payload:'',preview:'',committedAt:now}});
  await transactionAudit(tx,user,'IMPORT','DataImportBatch',id,JSON.stringify({source:data.source,clients:result.clients,cases:result.cases,travellers:result.travellers,linked:result.linked}));
  return result;
 },{timeout:60000});
}

export async function undoImport(db:PrismaClient,id:string,user:SessionUser){
 assertImportAccess(user);
 return db.$transaction(async tx=>{
  const batch=await tx.dataImportBatch.findUnique({where:{id}});if(!batch||batch.actorId!==user.id)throw new ApiError(404,'Import batch unavailable.');if(batch.status==='ROLLED_BACK')return{ok:true,replayed:true};if(batch.status!=='COMMITTED')throw new ApiError(409,'Only a completed import can be undone.');
  const result=JSON.parse(batch.result!) as ImportResult,caseIds=result.records.filter(x=>x.entity==='CASE').map(x=>x.id),travellerIds=result.records.filter(x=>x.entity==='TRAVELLER').map(x=>x.id);
  const block=()=>{throw new ApiError(409,'Imported records have been used or changed. Undo is blocked; correct the records through their normal workflows.');};
  for(const link of await tx.dataImportIdentity.findMany({where:{batchId:id,entity:'CLIENT',linked:true}})){
   const laterCases=await tx.$queryRaw<{n:bigint|number}[]>`SELECT COUNT(*) AS n FROM "DataImportIdentity" i JOIN "ServiceCase" c ON i."recordId"=c.id WHERE i.source=${batch.source} AND i.entity='CASE' AND i."batchId"<>${id} AND c."customerId"=${link.recordId}`;
   const laterTravellers=await tx.$queryRaw<{n:bigint|number}[]>`SELECT COUNT(*) AS n FROM "DataImportIdentity" i JOIN "Traveller" t ON i."recordId"=t.id WHERE i.source=${batch.source} AND i.entity='TRAVELLER' AND i."batchId"<>${id} AND t."customerId"=${link.recordId}`;
   if(Number(laterCases[0].n)||Number(laterTravellers[0].n))block();
  }
  for(const item of result.records){
   if(await tx.dataImportIdentity.count({where:{recordId:item.id,batchId:{not:id}}}))block();
   if(item.entity==='CASE'){
    const c=await tx.serviceCase.findUnique({where:{id:item.id},include:{staffChatThread:{select:{id:true}},_count:{select:{bookings:true,visaCases:true,leads:true,messages:true,events:true}},tasks:{include:{_count:{select:{comments:true,events:true}}}}}});
    if(!c)block();else{const{_count,tasks,staffChatThread,...scalar}=c;if(importHash({...scalar,updatedAt:undefined})!==item.hash||_count.bookings+_count.visaCases+_count.leads+_count.messages||staffChatThread||_count.events!==2||tasks.length!==(['COMPLETED','CANCELLED'].includes(c.status)?0:1)||tasks.some(t=>t.version!==1||t.workState!=='TODO'||t.status!=='OPEN'||t._count.comments||t._count.events))block();}
   }else if(item.entity==='TRAVELLER'){
    const t=await tx.traveller.findUnique({where:{id:item.id},include:{_count:{select:{documents:true,uploadLinks:true,caseTravellers:true,bookingTravellers:true,loyaltyMemberships:true,identityDocuments:true}}}});
    if(!t||t.profileData||importHash(travellerSnapshot(t))!==item.hash||Object.values(t._count).some(n=>n>0))block();
   }else{
    const c=await tx.customer.findUnique({where:{id:item.id},include:{_count:{select:{bookings:true,visaCases:true,documents:true,payments:true,invoices:true,refunds:true,notes:true,activities:true,whatsappThreads:true,whatsappAttachments:true,uploadLinks:true,masterMutations:true,agencyMutations:true,emailOutbox:true,collections:true}},serviceCases:{select:{id:true}},travellers:{select:{id:true}},tasks:{select:{serviceCaseId:true}}}});
    if(!c||c.profileData||c.mergedIntoId||importHash(clientSnapshot(c))!==item.hash||Object.values(c._count).some(n=>n>0)||c.serviceCases.some(x=>!caseIds.includes(x.id))||c.travellers.some(x=>!travellerIds.includes(x.id))||c.tasks.some(t=>!t.serviceCaseId||!caseIds.includes(t.serviceCaseId)))block();
   }
  }
  const taskIds=(await tx.task.findMany({where:{serviceCaseId:{in:caseIds}},select:{id:true}})).map(t=>t.id);
  if(await tx.auditLog.count({where:{entityId:{in:[...result.records.map(r=>r.id),...taskIds]},at:{gte:batch.committedAt!}}}))block();
  await tx.task.deleteMany({where:{serviceCaseId:{in:caseIds}}});await tx.serviceCaseEvent.deleteMany({where:{caseId:{in:caseIds}}});await tx.serviceWork.deleteMany({where:{caseId:{in:caseIds}}});await tx.serviceCase.deleteMany({where:{id:{in:caseIds}}});await tx.traveller.deleteMany({where:{id:{in:travellerIds}}});await tx.customer.deleteMany({where:{id:{in:result.records.filter(x=>x.entity==='CLIENT').map(x=>x.id)}}});
  await tx.dataImportIdentity.deleteMany({where:{batchId:id}});await tx.dataImportBatch.update({where:{id},data:{status:'ROLLED_BACK'}});await transactionAudit(tx,user,'IMPORT_UNDO','DataImportBatch',id,'Unused imported records removed; case numbering retained.');return{ok:true};
 },{timeout:60000});
}
