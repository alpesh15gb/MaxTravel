/** Bounded, scope-first discovery. No customer ID prefetch or display-cap filtering. */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { accessModeFor } from "./rbac";
import { ApiError, scopeWhere } from "./guard";

export const SALES_PAGE_SIZE = 50;
const stages = ["NEW", "QUALIFIED", "QUOTED", "WON", "LOST"];
type LeadCursor = { id: string; createdAt: string };
type CustomerCursor = { id: string; nameRevision: string };
const nameRevision = (name: string) => createHash("sha256").update(name).digest("hex");
export const salesCustomerCursor = (customer: { id: string; name: string }) => Buffer.from(JSON.stringify({ id: customer.id, nameRevision: nameRevision(customer.name) })).toString("base64url");
export type SalesFilters = { q: string; stage: string; cursor?: LeadCursor; customerCursor?: CustomerCursor };
const validId = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
export function salesFilters(params: URLSearchParams, customers = false): SalesFilters {
  const one = (key: string) => { if (params.getAll(key).length > 1) throw new ApiError(400, "Use one value per search filter."); return params.get(key) ?? ""; };
  const q = one("q").trim(), stage = one("stage"), raw = one("cursor");
  if (q.length > 100 || /[\u0000-\u001f]/.test(q) || (stage && stage !== "ALL" && !stages.includes(stage))) throw new ApiError(400, "Check the search text and stage filter.");
  const filters: SalesFilters = { q, stage: stage === "ALL" ? "" : stage };
  if (!raw) return filters;
  try {
    if (customers) {
      if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
      const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      if (!value || typeof value.id !== "string" || !validId(value.id) || typeof value.nameRevision !== "string" || !/^[a-f0-9]{64}$/.test(value.nameRevision)) throw Error();
      filters.customerCursor = { id: value.id, nameRevision: value.nameRevision };
    }
    else {
      if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
      const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      if (!value || typeof value.id !== "string" || !validId(value.id) || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || new Date(value.createdAt).toISOString() !== value.createdAt) throw Error();
      filters.cursor = { id: value.id, createdAt: value.createdAt };
    }
  } catch { throw new ApiError(400, "This list position is invalid. Search again from the first page."); }
  return filters;
}

// SalesLead intentionally has no Prisma customer relation. A parameterized join applies both
// scopes BEFORE LIMIT, so inaccessible/merged customers cannot consume a whole visible page.
export function salesDiscoveryScope(user: SessionUser): Prisma.Sql {
  const mode = user.accessMode ?? accessModeFor(user.role);
  if (mode === "ALL") return Prisma.sql`1 = 1`;
  if (mode === "BRANCH") return user.branchId ? Prisma.sql`l."branchId" = ${user.branchId} AND c."branchId" = ${user.branchId}` : Prisma.sql`1 = 0`;
  return Prisma.sql`l."ownerId" = ${user.id} AND c."assignedToId" = ${user.id}`;
}
export async function salesLeadPage(db: PrismaClient, user: SessionUser, filters: SalesFilters, leadId?: string) {
  const clauses = [salesDiscoveryScope(user), Prisma.sql`c."mergedIntoId" IS NULL`];
  if (leadId) clauses.push(Prisma.sql`l."id" = ${leadId}`);
  else {
    if (filters.stage) clauses.push(Prisma.sql`l."stage" = ${filters.stage}`);
    if (filters.q) {
      // Literal substring search, not caller-controlled SQL LIKE wildcards.
      const term = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(Prisma.sql`(l."title" LIKE ${term} ESCAPE '\\' OR l."source" LIKE ${term} ESCAPE '\\' OR l."destination" LIKE ${term} ESCAPE '\\' OR l."product" LIKE ${term} ESCAPE '\\' OR c."name" LIKE ${term} ESCAPE '\\' OR c."code" LIKE ${term} ESCAPE '\\')`);
    }
    if (filters.cursor) { const date = new Date(filters.cursor.createdAt); clauses.push(Prisma.sql`(l."createdAt" < ${date} OR (l."createdAt" = ${date} AND l."id" < ${filters.cursor.id}))`); }
  }
  return db.$transaction(async tx => {
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT l."id" FROM "SalesLead" l INNER JOIN "Customer" c ON c."id" = l."customerId" WHERE ${Prisma.join(clauses, " AND ")} ORDER BY l."createdAt" DESC, l."id" DESC LIMIT ${leadId ? 1 : SALES_PAGE_SIZE + 1}`);
    const rows = await tx.salesLead.findMany({ where: { id: { in: ids.slice(0, SALES_PAGE_SIZE).map(row => row.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { quotes: { orderBy: { version: "desc" } } } });
    const last = rows.at(-1);
    const nextCursor = ids.length > SALES_PAGE_SIZE && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString("base64url") : null;
    return { leads: rows, nextCursor };
  });
}

export const salesCustomerScope = (user: SessionUser): Prisma.CustomerWhereInput => ({ AND: [scopeWhere(user, null, undefined, "assignedToId"), { mergedIntoId: null }] });
export const salesCustomerSelect = { id: true, name: true, code: true } as const;
export async function salesCustomerPage(db: PrismaClient, user: SessionUser, filters: SalesFilters) {
  const conditions: Prisma.CustomerWhereInput[] = [salesCustomerScope(user)];
  if (filters.q) conditions.push({ OR: [{ name: { contains: filters.q } }, { code: { contains: filters.q } }] });
  if (filters.customerCursor) {
    // Lookup is scoped too; a guessed/foreign cursor never reveals or reads another customer's name.
    const cursor = await db.customer.findFirst({ where: { AND: [...conditions, { id: filters.customerCursor.id }] }, select: { id: true, name: true } });
    if (!cursor || nameRevision(cursor.name) !== filters.customerCursor.nameRevision) throw new ApiError(400, "The customer list changed. Search again from the first page.");
    conditions.push({ OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] });
  }
  const results = await db.customer.findMany({ where: { AND: conditions }, select: salesCustomerSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: SALES_PAGE_SIZE + 1 });
  const customers = results.slice(0, SALES_PAGE_SIZE);
  return { customers, nextCursor: results.length > SALES_PAGE_SIZE ? salesCustomerCursor(customers.at(-1)!) : null };
}
