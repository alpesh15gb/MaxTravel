import { prisma } from "./db";
import type { SessionUser } from "./session";
import { caseFor, childWorkScope } from "./service-cases";
import { taskScope } from "./work-engine";

export type TripHistoryRow = { id: string; at: Date; who: string; what: string; href?: string };

const PAGE = 50;
/** Read-only actions (viewing, signing a download link, exporting) are not changes, so they stay out of the trip timeline. */
const READS = /(^|_)(VIEW|SIGN_URL|EXPORT|DOWNLOAD|OPEN|READ)$/;
const ENTITY: Record<string, string> = { ServiceCase: "Max ID", Booking: "Booking", VisaCase: "Visa", Invoice: "Invoice", Payment: "Payment", Task: "To-do", Document: "Document" };
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();

function describe(action: string, entity: string, ref: string, detail: string | null): string {
  const verb = action === "CREATE" ? "created" : action === "UPDATE" || action === "EDIT" ? "changed" : action === "DELETE" ? "removed" : words(action);
  let extra = "";
  if (detail) {
    try {
      const d = JSON.parse(detail);
      if (d && typeof d === "object") {
        const parts: string[] = [];
        if (Array.isArray(d.fields) && d.fields.length) parts.push(d.fields.map((f: unknown) => words(String(f))).join(", "));
        if ("from" in d || "to" in d) parts.push(`${d.from ?? "—"} → ${d.to ?? "—"}`);
        if (typeof d.status === "string") parts.push(`status ${words(d.status)}`);
        extra = parts.join(": ");
      }
    } catch {
      if (detail.length <= 120 && detail !== ref) extra = detail;
    }
  }
  return `${ENTITY[entity] ?? entity} ${ref} ${verb}${extra ? ` — ${extra}` : ""}`.replace(/\s+/g, " ").trim();
}

export async function tripHistory(user: SessionUser, caseId: string, page: number): Promise<{ rows: TripHistoryRow[]; more: boolean }> {
  const trip = await caseFor(prisma, user, caseId);
  const take = Math.max(1, Math.floor(page)) * PAGE;
  const can = (p: string) => user.permissions.includes(p as SessionUser["permissions"][number]);
  const events = prisma.serviceCaseEvent.findMany({ where: { caseId: trip.id, OR: [{ permission: null }, { permission: { in: [...user.permissions] } }] }, orderBy: [{ at: "desc" }, { id: "desc" }], take: take + 1 });
  let audits: Promise<{ id: string; at: Date; userId: string | null; action: string; entity: string; entityId: string | null; detail: string | null }[]> = Promise.resolve([]);
  const refs = new Map<string, { ref: string; href?: string }>([[`ServiceCase:${trip.id}`, { ref: trip.caseNo }]]);
  if (can("audit:view")) {
    const [bookings, visas, tasks] = await Promise.all([
      can("ticketing:view") ? prisma.booking.findMany({ where: { AND: [{ serviceCaseId: trip.id }, childWorkScope(user)] }, select: { id: true, bookingNo: true } }) : [],
      can("visa:view") ? prisma.visaCase.findMany({ where: { AND: [{ serviceCaseId: trip.id }, childWorkScope(user)] }, select: { id: true, caseNo: true } }) : [],
      can("task:view") ? prisma.task.findMany({ where: { AND: [{ serviceCaseId: trip.id }, taskScope(user)] }, select: { id: true, title: true } }) : [],
    ]);
    const source = { OR: [{ bookingId: { in: bookings.map(b => b.id) } }, { visaCaseId: { in: visas.map(v => v.id) } }] };
    const [invoices, payments, documents] = await Promise.all([
      can("payment:view") ? prisma.invoice.findMany({ where: source, select: { id: true, invoiceNo: true } }) : [],
      can("payment:view") ? prisma.payment.findMany({ where: source, select: { id: true, receiptNo: true } }) : [],
      can("document:view") && visas.length ? prisma.document.findMany({ where: { visaCaseId: { in: visas.map(v => v.id) } }, select: { id: true, docNo: true } }) : [],
    ]);
    for (const b of bookings) refs.set(`Booking:${b.id}`, { ref: b.bookingNo, href: `/ticketing/${b.id}` });
    for (const v of visas) refs.set(`VisaCase:${v.id}`, { ref: v.caseNo, href: `/visa/${v.id}` });
    for (const t of tasks) refs.set(`Task:${t.id}`, { ref: `“${t.title}”`, href: `/work?task=${t.id}` });
    for (const i of invoices) refs.set(`Invoice:${i.id}`, { ref: i.invoiceNo, href: `/payments?focus=${i.id}` });
    for (const p of payments) refs.set(`Payment:${p.id}`, { ref: p.receiptNo, href: `/payments?focus=${p.id}` });
    for (const d of documents) refs.set(`Document:${d.id}`, { ref: d.docNo, href: `/documents?focus=${d.id}` });
    const byEntity = new Map<string, string[]>();
    for (const key of refs.keys()) { const [e, id] = key.split(":"); byEntity.set(e, [...(byEntity.get(e) ?? []), id]); }
    audits = prisma.auditLog.findMany({ where: { OR: [...byEntity].map(([entity, ids]) => ({ entity, entityId: { in: ids } })) }, orderBy: [{ at: "desc" }, { id: "desc" }], take: take * 2 + 1 });
  }
  const [e, a] = await Promise.all([events, audits]);
  const changes = a.filter(x => !READS.test(x.action));
  const ids = [...new Set([...e.map(x => x.actorId), ...changes.map(x => x.userId)].filter((x): x is string => Boolean(x)))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
  const who = (id: string | null) => (id ? names.get(id) ?? "Former staff member" : "System");
  const rows: TripHistoryRow[] = [
    ...e.map(x => ({ id: `e:${x.id}`, at: x.at, who: who(x.actorId), what: x.summary, href: x.href ?? undefined })),
    ...changes.map(x => { const r = refs.get(`${x.entity}:${x.entityId}`)!; return { id: `a:${x.id}`, at: x.at, who: who(x.userId), what: describe(x.action, x.entity, r.ref, x.detail), href: r.href }; }),
  ].sort((p, q) => q.at.getTime() - p.at.getTime() || q.id.localeCompare(p.id));
  const start = take - PAGE;
  return { rows: rows.slice(start, take), more: rows.length > take };
}
