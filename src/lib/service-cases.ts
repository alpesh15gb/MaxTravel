import type { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { ApiError, canTouchRecord, scopeWhere } from "./guard";
import { nextReference,customerFor } from "./transactions";
import { readCaseConfig } from "./case-config";
import {ROLE_PERMISSIONS,type RoleKey} from "./permissions";

export {CASE_READ,CASE_STATUSES,CASE_SERVICES} from "./case-constants";
export const canCreateCase=(user:SessionUser)=>["visa:create","ticketing:create"].some(p=>user.permissions.includes(p as typeof user.permissions[number]));
export const canEditCase=(user:SessionUser)=>["customer:edit","visa:edit","ticketing:edit"].some(p=>user.permissions.includes(p as typeof user.permissions[number]));
export const canAssignCase=(user:SessionUser)=>user.permissions.includes("employee:manage")||user.permissions.includes("settings:manage");
export const roleCanOwnCase=(role:string)=>["customer:edit","visa:edit","ticketing:edit"].some(permission=>(ROLE_PERMISSIONS[role as RoleKey]??[]).some(value=>value===permission));
export function serviceCaseScope(user:SessionUser):Prisma.ServiceCaseWhereInput {
  if(user.accessMode==="ALL")return {};
  if(user.accessMode==="BRANCH")return user.branchId?{branchId:user.branchId}:{id:"__none__"};
  return {OR:[{ownerId:user.id},{createdById:user.id,customer:{assignedToId:user.id}},...(user.permissions.includes("ticketing:view")?[{bookings:{some:{ownerId:user.id}}}]:[]),...(user.permissions.includes("visa:view")?[{visaCases:{some:{ownerId:user.id}}}]:[]),...(user.permissions.includes("customer:view")?[{leads:{some:{ownerId:user.id}}}]:[])]};
}
export async function caseFor(db:Prisma.TransactionClient|PrismaClient,user:SessionUser,id:string){
  const row=await db.serviceCase.findFirst({where:{AND:[serviceCaseScope(user),{OR:[{id},{caseNo:id}]}]}});
  if(!row)throw new ApiError(404,"Case not found or outside your access.");return row;
}
export async function createServiceCase(tx:Prisma.TransactionClient,input:{customerId:string;branchId:string;ownerId:string;service:string;title:string},actorId:string|null){
  const config=readCaseConfig((await tx.settings.findUnique({where:{key:"case.configuration"}}))?.value);
  let ownerId=input.ownerId;
  if(config.defaultOwnerId){const owner=await tx.user.findUnique({where:{id:config.defaultOwnerId},include:{role:true}});if(owner?.active&&owner.branchId===input.branchId&&roleCanOwnCase(owner.role.key))ownerId=owner.id;}
  let caseNo="";
  for(let attempt=0;attempt<50;attempt++){const candidate=(await nextReference(tx,"CASE")).replace(/^CASE-/,config.referencePrefix+"-");if(!(await tx.serviceCase.count({where:{caseNo:candidate}}))){caseNo=candidate;break;}}
  if(!caseNo)throw new ApiError(409,"Could not allocate a case reference.");
  const row=await tx.serviceCase.create({data:{...input,createdById:actorId,ownerId,caseNo,nextFollowUpAt:config.followUpDays?new Date(Date.now()+config.followUpDays*86400000):null}});
  await tx.serviceCaseEvent.create({data:{caseId:row.id,actorId,kind:"OPENED",summary:"Customer request registered"}});return row;
}
export async function resolveServiceCase(tx:Prisma.TransactionClient,user:SessionUser,input:{caseId?:unknown;customerId:string;branchId:string;ownerId:string;service:string;title:string}){
  if(input.caseId!==undefined&&input.caseId!==null&&input.caseId!==""){
    if(typeof input.caseId!=="string"||input.caseId.length>200)throw new ApiError(400,"Choose a valid case.");
    const row=await caseFor(tx,user,input.caseId);
    if(row.customerId!==input.customerId||row.branchId!==input.branchId||row.service!==input.service)throw new ApiError(400,"Case customer and service must match this transaction.");
    if(["COMPLETED","CANCELLED"].includes(row.status))throw new ApiError(409,"Reopen the case before adding work.");
    return row;
  }
  const {caseId:unused,...data}=input;void unused;return createServiceCase(tx,data,user.id);
}
/** Selection on an entry screen is revalidated inside the eventual write transaction. */
export async function caseEntryContext(db:PrismaClient,user:SessionUser,id?:string){return id?caseFor(db,user,id):null;}
export async function customerForCase(tx:Prisma.TransactionClient,user:SessionUser,customerId:string,caseId?:unknown){
  if(!caseId)return customerFor(tx,user,customerId);
  if(typeof caseId!=="string")throw new ApiError(400,"Choose a valid case.");
  const journey=await caseFor(tx,user,caseId);
  if(journey.customerId!==customerId)throw new ApiError(400,"Case customer must match this transaction.");
  const customer=await tx.customer.findUnique({where:{id:customerId}});
  if(!customer||customer.mergedIntoId)throw new ApiError(409,"Open the retained customer profile before adding work.");return customer;
}
export async function assertCaseOwner(tx:Prisma.TransactionClient,user:SessionUser,ownerId:string,branchId:string){
  if(ownerId!==user.id&&!canAssignCase(user))throw new ApiError(403,"Only an administrator can assign another case owner.");
  const owner=await tx.user.findUnique({where:{id:ownerId},include:{role:true}});
  if(!owner?.active||!roleCanOwnCase(owner.role.key)||(user.accessMode!=="ALL"&&ownerId!==user.id&&owner.branchId!==branchId))throw new ApiError(400,"Choose an active owner with case access within this branch.");
}
export const childWorkScope=(user:SessionUser)=>scopeWhere(user,null,"ownerId");
export const caseCustomerScope=(user:SessionUser)=>scopeWhere(user,null,undefined,"assignedToId");
export function caseOwnedBy(user:SessionUser,row:{ownerId:string;branchId:string}){return canTouchRecord(user,row);}
