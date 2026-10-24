import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { salesCustomerScope, salesDiscoveryScope } from "./sales-discovery";

export const CUSTOMER_ENQUIRY_LIMIT = 20;
export const CUSTOMER_QUOTE_LIMIT = 3;

/** Read-only, identity-based history. Both scopes apply before counting or limiting.
 * Deliberately excludes financial fields, quote items, private hashes and share tokens. */
export async function customerSalesHistory(db: PrismaClient, customerId: string, user: SessionUser, now = Date.now()) {
  const empty = { accessible: false, total: 0, enquiries: [] };
  if (!user.permissions.includes("customer:view")) return empty;
  return db.$transaction(async tx => {
    const customer = await tx.customer.findFirst({ where: { AND: [salesCustomerScope(user), { id: customerId }] }, select: { id: true } });
    if (!customer) return empty;
    const where = Prisma.sql`${salesDiscoveryScope(user)} AND c."mergedIntoId" IS NULL AND c."id" = ${customerId}`;
    const counts = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM "SalesLead" l INNER JOIN "Customer" c ON c."id" = l."customerId" WHERE ${where}`);
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT l."id" FROM "SalesLead" l INNER JOIN "Customer" c ON c."id" = l."customerId" WHERE ${where} ORDER BY l."createdAt" DESC, l."id" DESC LIMIT ${CUSTOMER_ENQUIRY_LIMIT}`);
    const rows = await tx.salesLead.findMany({
      where: { id: { in: ids.map(row => row.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, product: true, stage: true, destination: true, followUpAt: true,
        _count: { select: { quotes: true } },
        quotes: { orderBy: { version: "desc" }, take: CUSTOMER_QUOTE_LIMIT,
          select: { id: true, version: true, state: true, expiresAt: true, acceptedAt: true, bookingId: true } } },
    });
    return { accessible: true, total: Number(counts[0].total), enquiries: rows.map(row => ({
      id: row.id, title: row.title, product: row.product, stage: row.stage, destination: row.destination,
      followUpAt: row.followUpAt?.toISOString() ?? null, href: `/sales?lead=${encodeURIComponent(row.id)}`,
      quoteCount: row._count.quotes,
      quotes: row.quotes.map(quote => ({ id: quote.id, version: quote.version,
        state: quote.bookingId ? "CONVERTED" : ["DRAFT", "PUBLISHED"].includes(quote.state) && quote.expiresAt.getTime() <= now ? "EXPIRED" : quote.state,
        expiresAt: quote.expiresAt.toISOString(), acceptedAt: quote.acceptedAt?.toISOString() ?? null,
      })),
    })) };
  });
}

export type CustomerSalesHistory = Awaited<ReturnType<typeof customerSalesHistory>>;
