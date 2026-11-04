import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./session";
import { serviceCaseScope, caseFor, childWorkScope, canEditCase } from "./service-cases";
import { caseFinance } from "./case-finance";
import { taskScope } from "./work-engine";
import { enumLabel } from "./labels";
import { isReservedBookingSource } from "./booking-policy";
import { tripStage, tripDates, isDeadVisaStage, TRIP_STAGES, type TripStage, type TripStageInput } from "./trip-stage";
import { istDayKey } from "./dates";

export type TripService = { kind: "FLIGHT" | "HOTEL" | "VISA" | "OTHER" | "ENQUIRY"; label: string; status: string; href: string; dead: boolean };
export type TripRow = {
  id: string; caseNo: string; title: string;
  customer: { id: string; name: string; code: string };
  owner: string; stage: TripStage; start: string | null; end: string | null;
  services: TripService[]; online: boolean; balanceMinor: number | null;
  /** Expected gross profit (INR, or the first currency) for staff who can see money; marginMinor is null while any cost is unconfirmed. */
  profit: { marginMinor: number | null; unknown: number } | null;
  nextTodo: { title: string; dueAt: string | null; overdue: boolean } | null;
};
export type TripDetail = Omit<TripRow, "customer"> & {
  customer: { id: string; name: string; code: string; phone: string; email: string | null };
  branchId: string; ownerId: string; caseStatus: string; canEdit: boolean;
  quotes: { leadId: string; title: string; stage: string; latestQuote: { id: string; state: string; totalMinor: number } | null }[];
  money: { invoicedMinor: number; receivedMinor: number; dueMinor: number } | null;
  documents: { id: string; docNo: string; docType: string; status: string }[];
};
export type TripView = "flights" | "hotels" | "visas" | "enquiries" | "online";
export const TRIP_VIEWS: TripView[] = ["flights", "hotels", "visas", "enquiries", "online"];
export type TripQuery = {
  stage?: TripStage | "ACTIVE"; search?: string; mine?: boolean; customerId?: string; view?: TripView; page?: number;
  /** Only trips whose travel overlaps today..today+N (India days); returns every match, not a page. */
  travellingWithinDays?: number;
  /** Leave balance/profit empty (null) to avoid per-trip money lookups. */
  skipFinance?: boolean;
};
const VIEW_KIND: Record<Exclude<TripView, "online">, TripService["kind"]> = { flights: "FLIGHT", hotels: "HOTEL", visas: "VISA", enquiries: "ENQUIRY" };

const PAGE = 50, CAP = 500;
const DEAD_BOOKING = new Set(["CANCELLED", "VOID", "REFUNDED"]);
const OPEN_TASK = { status: { notIn: ["DONE", "CANCELLED"] } };

function include(user: SessionUser) {
  const can = (p: string) => user.permissions.includes(p as SessionUser["permissions"][number]);
  const child = childWorkScope(user);
  return {
    customer: { select: { id: true, name: true, code: true, phone: true, email: true } },
    owner: { select: { name: true } },
    bookings: { where: can("ticketing:view") ? child : { id: "__none__" }, select: { id: true, bookingNo: true, status: true, product: true, sector: true, hotelName: true, serviceDescription: true, travelDate: true, hotelCheckIn: true, gdsSource: true }, orderBy: { createdAt: "asc" as const } },
    visaCases: { where: can("visa:view") ? child : { id: "__none__" }, select: { id: true, caseNo: true, destination: true, visaType: true, travelDate: true, travelEndDate: true, stage: { select: { key: true, name: true } } }, orderBy: { createdAt: "asc" as const } },
    leads: { where: can("customer:view") ? child : { id: "__none__" }, select: { id: true, title: true, stage: true, travelDate: true, destination: true, quotes: { select: { id: true, state: true, totalMinor: true, version: true }, orderBy: { version: "desc" as const } } }, orderBy: { createdAt: "asc" as const } },
    tasks: { where: can("task:view") ? { AND: [OPEN_TASK, taskScope(user)] } : { id: "__none__" }, select: { title: true, dueAt: true }, orderBy: [{ dueAt: { sort: "asc" as const, nulls: "last" as const } }, { createdAt: "asc" as const }], take: 1 },
  } satisfies Prisma.ServiceCaseInclude;
}
type Loaded = Prisma.ServiceCaseGetPayload<{ include: ReturnType<typeof include> }>;

/** Stage and dates come from every service on the trip, not only the ones this role may open, so all staff see the same stage. Only statuses and dates are read. */
const STAGE_FACTS = {
  id: true, status: true,
  bookings: { select: { status: true, travelDate: true, travelEndDate: true, hotelCheckIn: true, hotelCheckOut: true, gdsSource: true } },
  visaCases: { select: { travelDate: true, travelEndDate: true, stage: { select: { key: true } } } },
  leads: { select: { stage: true, travelDate: true, quotes: { select: { state: true } } } },
} satisfies Prisma.ServiceCaseSelect;
type Facts = Prisma.ServiceCaseGetPayload<{ select: typeof STAGE_FACTS }>;
async function stageFacts(ids: string[]): Promise<Map<string, Facts>> {
  const rows = ids.length ? await prisma.serviceCase.findMany({ where: { id: { in: ids } }, select: STAGE_FACTS }) : [];
  return new Map(rows.map(r => [r.id, r]));
}
function stageInput(f: Facts, now: Date): TripStageInput {
  return {
    caseStatus: f.status, today: now,
    bookings: f.bookings.map(b => ({ status: b.status, travelDate: b.travelDate ?? b.hotelCheckIn, travelEndDate: b.travelEndDate ?? b.hotelCheckOut })),
    visas: f.visaCases.map(v => ({ travelDate: v.travelDate, travelEndDate: v.travelEndDate, stageKey: v.stage.key })),
    leads: f.leads.map(l => ({ stage: l.stage, travelDate: l.travelDate, quoteStates: l.quotes.map(q => q.state) })),
  };
}

function toRow(c: Loaded, facts: Facts, now: Date): Omit<TripRow, "balanceMinor" | "profit"> {
  const input = stageInput(facts, now);
  const { start, end } = tripDates(input);
  const services: TripService[] = [
    ...c.bookings.map(b => ({
      kind: (b.product === "FLIGHT" || b.product === "HOTEL" ? b.product : "OTHER") as TripService["kind"],
      label: [b.bookingNo, b.product === "HOTEL" ? b.hotelName : b.product === "FLIGHT" ? b.sector : b.serviceDescription].filter(Boolean).join(" · "),
      status: enumLabel(b.status), href: `/ticketing/${b.id}`, dead: DEAD_BOOKING.has(b.status),
    })),
    ...c.visaCases.map(v => ({ kind: "VISA" as const, label: `${v.caseNo} · ${v.destination} ${v.visaType}`.trim(), status: v.stage.name, href: `/visa/${v.id}`, dead: isDeadVisaStage(v.stage.key) })),
    ...c.leads.map(l => ({ kind: "ENQUIRY" as const, label: l.title, status: enumLabel(l.stage), href: `/sales?lead=${l.id}`, dead: l.stage === "LOST" })),
  ];
  const t = c.tasks[0];
  return {
    id: c.id, caseNo: c.caseNo, title: c.title,
    customer: { id: c.customer.id, name: c.customer.name, code: c.customer.code },
    owner: c.owner.name, stage: tripStage(input),
    start: start?.toISOString() ?? null, end: end?.toISOString() ?? null, services,
    online: facts.bookings.some(b => isReservedBookingSource(b.gdsSource)),
    nextTodo: t ? { title: t.title, dueAt: t.dueAt?.toISOString() ?? null, overdue: Boolean(t.dueAt && t.dueAt < now) } : null,
  };
}

async function finance(user: SessionUser, id: string): Promise<Pick<TripRow, "balanceMinor" | "profit">> {
  if (!user.permissions.includes("payment:view")) return { balanceMinor: null, profit: null };
  const { groups } = await caseFinance(prisma, user, id);
  const g = groups.find(x => x.currency === "INR") ?? groups[0];
  return { balanceMinor: g?.balance ?? 0, profit: g ? { marginMinor: g.margin, unknown: g.unknown } : null };
}

export async function readTrips(user: SessionUser, q: TripQuery): Promise<{ rows: TripRow[]; total: number; counts: Record<TripStage, number>; capped: boolean }> {
  const search = q.search?.trim();
  const can = (p: string) => user.permissions.includes(p as SessionUser["permissions"][number]);
  const child = childWorkScope(user);
  const where: Prisma.ServiceCaseWhereInput = {
    AND: [
      serviceCaseScope(user),
      ...(q.customerId ? [{ customerId: q.customerId }] : []),
      ...(q.mine ? [{ ownerId: user.id }] : []),
      ...(search ? [{ OR: [{ caseNo: { contains: search } }, { title: { contains: search } }, { customer: { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { code: { contains: search } }] } }, ...(can("ticketing:view") ? [{ bookings: { some: { AND: [child, { OR: [{ pnr: { contains: search } }, { bookingNo: { contains: search } }, { sector: { contains: search } }, { hotelName: { contains: search } }] }] } } }] : []), ...(can("visa:view") ? [{ visaCases: { some: { AND: [child, { OR: [{ destination: { contains: search } }, { caseNo: { contains: search } }] }] } } }] : []), { leads: { some: { AND: [child, { destination: { contains: search } }] } } }] }] : []),
    ],
  };
  const now = new Date();
  const loaded = await prisma.serviceCase.findMany({ where, include: include(user), orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: CAP });
  const facts = await stageFacts(loaded.map(c => c.id));
  const today = istDayKey(now), until = istDayKey(new Date(now.getTime() + (q.travellingWithinDays ?? 0) * 86400000));
  const all = loaded.map(c => toRow(c, facts.get(c.id)!, now))
    .filter(r => q.travellingWithinDays === undefined || (r.start !== null && istDayKey(r.start) <= until && istDayKey(r.end ?? r.start) >= today))
    .filter(r => !q.view || (q.view === "online" ? r.online : r.services.some(x => x.kind === VIEW_KIND[q.view as Exclude<TripView, "online">])));
  const counts = Object.fromEntries([...TRIP_STAGES, "CANCELLED"].map(s => [s, 0])) as Record<TripStage, number>;
  for (const r of all) counts[r.stage]++;
  const filtered = !q.stage ? all : q.stage === "ACTIVE" ? all.filter(r => r.stage !== "DONE" && r.stage !== "CANCELLED") : all.filter(r => r.stage === q.stage);
  const page = Math.max(1, Math.floor(q.page ?? 1));
  const slice = q.travellingWithinDays !== undefined ? filtered : filtered.slice((page - 1) * PAGE, page * PAGE);
  const rows = await Promise.all(slice.map(async r => ({ ...r, ...(q.skipFinance ? { balanceMinor: null, profit: null } : await finance(user, r.id)) })));
  return { rows, total: filtered.length, counts, capped: loaded.length === CAP };
}

export async function readTrip(user: SessionUser, id: string): Promise<TripDetail> {
  const base = await caseFor(prisma, user, id);
  const c = await prisma.serviceCase.findUniqueOrThrow({ where: { id: base.id }, include: include(user) });
  const row = toRow(c, (await stageFacts([c.id])).get(c.id)!, new Date());
  let money: TripDetail["money"] = null, balanceMinor: number | null = null, profit: TripRow["profit"] = null;
  if (user.permissions.includes("payment:view")) {
    const { groups } = await caseFinance(prisma, user, base.id);
    const g = groups.find(x => x.currency === "INR") ?? groups[0];
    money = { invoicedMinor: g?.sale ?? 0, receivedMinor: g?.received ?? 0, dueMinor: g?.balance ?? 0 };
    balanceMinor = money.dueMinor;
    profit = g ? { marginMinor: g.margin, unknown: g.unknown } : null;
  }
  const documents = user.permissions.includes("document:view") && c.visaCases.length
    ? await prisma.document.findMany({ where: { visaCaseId: { in: c.visaCases.map(v => v.id) } }, select: { id: true, docNo: true, docType: true, status: true }, orderBy: { createdAt: "desc" }, take: 100 })
    : [];
  return {
    ...row, balanceMinor, profit, money, documents,
    customer: { ...c.customer },
    branchId: c.branchId, ownerId: c.ownerId, caseStatus: c.status, canEdit: canEditCase(user),
    quotes: c.leads.map(l => ({ leadId: l.id, title: l.title, stage: l.stage, latestQuote: l.quotes[0] ? { id: l.quotes[0].id, state: l.quotes[0].state, totalMinor: l.quotes[0].totalMinor } : null })),
  };
}
