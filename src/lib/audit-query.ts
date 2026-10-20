import type { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { scopeWhere, ApiError } from "./guard";

export type AuditFilters = { actor?: string; from?: string; to?: string; action?: string; recordType?: string; entityId?: string };
export function auditFilters(params: URLSearchParams): AuditFilters {
  const result: AuditFilters = {};
  for (const key of ["actor", "from", "to", "action", "recordType", "entityId"] as const) {
    const value = params.get(key)?.trim();
    if (value) { if (value.length > 160) throw new ApiError(400, "Audit filter is too long."); result[key] = value; }
  }
  for (const key of ["from", "to"] as const) if (result[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]!) || !Number.isFinite(Date.parse(result[key]!)) || new Date(result[key]!).toISOString().slice(0,10) !== result[key])) throw new ApiError(400, "Choose a valid audit date.");
  if (result.from && result.to && result.from > result.to) throw new ApiError(400, "From date must not be after To date.");
  return result;
}
/** Current record access, not actor branch: staff may work on another branch's records.
 * Unknown/deleted/global entities fail closed for restricted users. ALL administrators retain them.
 */
export async function auditScope(db: PrismaClient, user: SessionUser): Promise<Prisma.AuditLogWhereInput> {
  if (user.accessMode === "ALL") return {};
  const customer = scopeWhere(user, null, undefined, "assignedToId");
  const work = scopeWhere(user, null, "ownerId");
  const [customers, bookings, visas, documents, travellers, payments, invoices, refunds, tasks] = await Promise.all([
    db.customer.findMany({where: customer, select:{id:true}}),
    db.booking.findMany({where: work, select:{id:true}}),
    db.visaCase.findMany({where: work, select:{id:true}}),
    db.document.findMany({where:{customer:{is:customer}},select:{id:true}}),
    db.traveller.findMany({where:{customer:{is:customer}},select:{id:true}}),
    db.payment.findMany({where:{customer:{is:customer}},select:{id:true}}),
    db.invoice.findMany({where:{customer:{is:customer}},select:{id:true}}),
    db.refund.findMany({where:{customer:{is:customer}},select:{id:true}}),
    db.task.findMany({where:scopeWhere(user,null,"ownerId"),select:{id:true}}),
  ]);
  return {OR: ["Customer","Booking","VisaCase","Document","Traveller","Payment","Invoice","Refund","Task"].map((entity,i)=>({entity,entityId:{in:[customers,bookings,visas,documents,travellers,payments,invoices,refunds,tasks][i].map(r=>r.id)}}))};
}
export async function auditWhere(db: PrismaClient, user: SessionUser, filters: AuditFilters): Promise<Prisma.AuditLogWhereInput> {
  const clauses: Prisma.AuditLogWhereInput[] = [await auditScope(db,user)];
  if (filters.actor === "system") clauses.push({userId:null});
  else if (filters.actor) clauses.push({user:{is:{OR:[{id:filters.actor},{name:{contains:filters.actor}},{employeeCode:{contains:filters.actor}}]}}});
  if (filters.action) clauses.push({action:filters.action});
  if (filters.recordType) clauses.push({entity:filters.recordType});
  if (filters.entityId) clauses.push({entityId:filters.entityId});
  if (filters.from || filters.to) clauses.push({at:{...(filters.from ? {gte:new Date(`${filters.from}T00:00:00.000+05:30`)} : {}),...(filters.to ? {lt:new Date(Date.parse(`${filters.to}T00:00:00.000+05:30`)+86400000)} : {})}});
  return {AND:clauses};
}
