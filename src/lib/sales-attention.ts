import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import type { PulseItem } from "./pulse";
import { salesDiscoveryScope } from "./sales-discovery";
import { dateTimeLabel } from "./dates";

export const SALES_ATTENTION_LIMIT = 50;
/** Agency dates are IST, matching all dashboard date labels (not the server timezone). */
export function salesDayEnd(now: number): Date {
  const offset = 330 * 60_000, day = 86_400_000;
  return new Date((Math.floor((now + offset) / day) + 1) * day - offset);
}
/** Read-only derived work: never manufactures tasks or deadlines. Scope is applied before LIMIT. */
export async function salesAttention(db: PrismaClient, user: SessionUser, now = Date.now()): Promise<PulseItem[]> {
  if (!user.permissions.includes("customer:view")) return [];
  const rows = await db.$queryRaw<{
    id: string; title: string; customerName: string; followUpAt: Date | null;
    quoteId: string | null; version: number | null;
  }[]>(Prisma.sql`
    SELECT l."id", l."title", c."name" AS "customerName", l."followUpAt", q."id" AS "quoteId", q."version"
    FROM "SalesLead" l INNER JOIN "Customer" c ON c."id" = l."customerId"
    LEFT JOIN "SalesQuote" q ON q."id" = (
      SELECT aq."id" FROM "SalesQuote" aq WHERE aq."leadId" = l."id"
      AND aq."state" = 'ACCEPTED' AND aq."bookingId" IS NULL ORDER BY aq."version" DESC LIMIT 1
    )
    WHERE ${salesDiscoveryScope(user)} AND c."mergedIntoId" IS NULL
      AND l."stage" IN ('NEW', 'QUALIFIED', 'QUOTED')
      AND (l."followUpAt" < ${salesDayEnd(now)} OR q."id" IS NOT NULL)
    ORDER BY CASE WHEN l."followUpAt" < ${new Date(now)} THEN 0 WHEN q."id" IS NOT NULL THEN 1 ELSE 2 END,
      l."followUpAt" ASC, l."id" ASC LIMIT ${SALES_ATTENTION_LIMIT + 1}
  `);
  const items: PulseItem[] = rows.slice(0, SALES_ATTENTION_LIMIT).map(row => {
    const href = `/sales?lead=${encodeURIComponent(row.id)}`;
    const overdue = row.followUpAt !== null && row.followUpAt.getTime() < now;
    const due = row.followUpAt !== null && row.followUpAt < salesDayEnd(now);
    return {
      id: `sales:${row.id}`, kind: row.quoteId ? "SALES_ACCEPTED_QUOTE" : "SALES_FOLLOW_UP",
      severity: overdue || row.quoteId ? "HIGH" : "MEDIUM",
      title: `${row.quoteId ? "Accepted quote needs booking review" : overdue ? "Overdue sales follow-up" : "Sales follow-up due today"} · ${row.title}`,
      detail: `${row.customerName}${row.quoteId ? ` · Quote v${row.version} · No CRM booking created` : ""}${due ? ` · Follow-up ${dateTimeLabel(row.followUpAt)}` : ""}`,
      href, ...(due ? { at: row.followUpAt!.toISOString() } : {}),
      actions: [{ label: row.quoteId ? "Review accepted quote" : "Open enquiry", href }],
    };
  });
  if (rows.length > SALES_ATTENTION_LIMIT) items.push({
    id: "capped:sales", kind: "LIST_CAPPED_SALES", severity: "MEDIUM",
    title: `List capped at ${SALES_ATTENTION_LIMIT} · sales enquiries`,
    detail: "Oldest overdue follow-ups first, then accepted quotes and today’s follow-ups. Open Sales for the remaining enquiries.",
    href: "/sales", actions: [{ label: "Open Sales", href: "/sales" }],
  });
  return items;
}
