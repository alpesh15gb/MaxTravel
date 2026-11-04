import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { computePulse, type PulseItem } from "@/lib/pulse";
import { taskScope } from "@/lib/work-engine";
import { childWorkScope } from "@/lib/service-cases";
import { readTrips, type TripRow } from "@/lib/trips-read";
import { teamLoad } from "@/lib/team-load";
import { isReservedBookingSource } from "@/lib/booking-policy";
import { dayChipLabel, dateLabel, dateTimeLabel, istDayKey } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import TripStageBar from "@/components/TripStageBar";
import Icon, { type IconName } from "@/components/Icon";
export const dynamic = "force-dynamic";

const ALERT_KINDS = new Set(["PNR_DEADLINE", "APPOINTMENT_TOMORROW", "VISA_APPOINTMENT_NEEDED", "VISA_BLOCKED_DOCS", "DOC_REUPLOAD", "DOC_UNVERIFIED", "PASSPORT_EXPIRY", "SUPPLIER_DUE", "REFUND_PENDING"]);
const DAY = 86400000;

function Card({ title, icon, count, seeAll, empty, children }: { title: string; icon: IconName; count?: number; seeAll?: string; empty: string; children: React.ReactNode[] }) {
  return <section className="panel flex flex-col p-5" aria-label={title}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Icon name={icon} size={18} className="text-teal-700" />{title}{count ? <span className="rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-700">{count}</span> : null}</h2>
      {seeAll && <Link className="text-sm text-blue-700 underline" href={seeAll}>See all</Link>}
    </div>
    {children.length ? <ul className="divide-y divide-slate-100">{children}</ul> : <p className="text-sm text-slate-500">{empty}</p>}
  </section>;
}
const Row = ({ href, title, detail, tone }: { href: string; title: string; detail?: string; tone?: "danger" | "warning" }) =>
  <li><Link href={href} className="block py-2.5 hover:bg-slate-50"><span className={`block text-sm font-medium ${tone === "danger" ? "text-rose-700" : tone === "warning" ? "text-amber-800" : "text-slate-900"}`}>{title}</span>{detail && <span className="block text-xs text-slate-500">{detail}</span>}</Link></li>;

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ denied?: string; action?: string }> }) {
  const user = await requirePage("dashboard:view"), sp = await searchParams;
  if (sp.action === "todo") redirect("/work?new=1");
  const can = (p: string) => user.permissions.includes(p as (typeof user.permissions)[number]);
  const now = new Date(), todayKey = istDayKey(now);
  const endOfToday = new Date(Date.parse(`${todayKey}T00:00:00+05:30`) + DAY);
  const tripsRead = ["customer:view", "ticketing:view", "visa:view"].some(can);
  const [pulse, todos, todoCount, trips, online, team] = await Promise.all([
    computePulse(prisma, user),
    can("task:view") ? prisma.task.findMany({ where: { AND: [taskScope(user), { status: { in: ["OPEN", "IN_PROGRESS"] }, ownerId: user.id, unassigned: false, dueAt: { lt: endOfToday } }] }, include: { serviceCase: { select: { caseNo: true, customer: { select: { name: true } } } } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: 8 }) : [],
    can("task:view") ? prisma.task.count({ where: { AND: [taskScope(user), { status: { in: ["OPEN", "IN_PROGRESS"] }, ownerId: user.id, unassigned: false, dueAt: { lt: endOfToday } }] } }) : 0,
    tripsRead ? readTrips(user, { stage: "ACTIVE", travellingWithinDays: 7, skipFinance: true }) : null,
    can("ticketing:view") ? prisma.booking.findMany({ where: { AND: [childWorkScope(user), { createdAt: { gte: new Date(now.getTime() - 2 * DAY) }, gdsSource: { not: null } }] }, select: { id: true, bookingNo: true, sector: true, gdsSource: true, serviceCaseId: true, createdAt: true, customer: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    can("task:view") ? teamLoad(user, now) : [],
  ]);
  const travelling = (trips?.rows ?? []).filter((t: TripRow) => t.stage === "TRAVELLING" || t.stage === "BOOKED");
  const items = pulse.items as PulseItem[];
  const payments = items.filter(i => i.kind === "PAYMENT_OVERDUE");
  const followUps = items.filter(i => i.kind === "SALES_FOLLOW_UP" || i.kind === "SALES_ACCEPTED_QUOTE" || i.kind === "CASE_FOLLOWUP");
  const alerts = items.filter(i => ALERT_KINDS.has(i.kind));
  const onlineRows = online.filter(b => isReservedBookingSource(b.gdsSource));
  const fresh = pulse.firstRun && !(trips?.counts && Object.values(trips.counts).some(Boolean));

  return <div className="workspace-page space-y-5">
    {sp.denied && <p role="alert" className="form-error">Your role does not allow that page. Choose one of the sections in the menu.</p>}
    <PageHeader eyebrow={dayChipLabel(now)} title={`Today`} description={`Hello ${user.name.split(" ")[0]}. Here is what needs doing now.`} actions={<>{tripsRead && <Link className="btn-primary" href="/trips/new">New trip</Link>}{can("task:create") && <Link className="btn-secondary" href="/work?new=1">New to-do</Link>}</>} />
    {fresh && <section className="panel p-5" aria-label="Get started">
      <h2 className="text-lg font-semibold">Get started</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {[["1", "Add a customer", "/masters?action=new"], ["2", "Start a trip for them", "/trips/new"], ["3", "Add your suppliers", "/suppliers"]].map(([n, label, href]) => <li key={n}><Link href={href} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-teal-600"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">{n}</span><span className="text-sm font-medium">{label}</span></Link></li>)}
      </ol>
    </section>}
    <div className="grid gap-4 lg:grid-cols-2">
      {can("task:view") && <Card title="My to-dos" icon="tasks" count={todoCount} seeAll="/work?view=mine" empty="Nothing due today. Well done.">
        {todos.map(t => <Row key={t.id} href={`/work?task=${t.id}`} title={t.title} tone={t.dueAt && t.dueAt < now ? "danger" : undefined} detail={[t.dueAt ? (t.dueAt < now ? `Overdue since ${dateTimeLabel(t.dueAt)}` : `Due ${dateTimeLabel(t.dueAt)}`) : "", t.serviceCase ? `${t.serviceCase.customer.name} · Max ID ${t.serviceCase.caseNo}` : ""].filter(Boolean).join(" · ")} />)}
      </Card>}
      {team.length > 0 && <Card title="Team" icon="customers" seeAll="/reports/work" empty="">
        {team.map(r => <li key={r.userId}><Link href={`/work?view=all&owner=${r.userId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-slate-50"><span className="font-medium">{r.name}</span><span className="flex gap-3 text-xs"><span>{r.open} open</span><span className={r.overdue ? "font-semibold text-rose-700" : "text-slate-500"}>{r.overdue} overdue</span><span className="text-slate-600">{r.dueToday} due today</span></span></Link></li>)}
      </Card>}
      {tripsRead && <Card title="Travelling in the next 7 days" icon="plane" count={travelling.length} seeAll="/trips" empty="No one is travelling this week.">
        {travelling.slice(0, 8).map(t => <li key={t.id}><Link href={`/trips/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-slate-50"><span className="min-w-0"><span className="block text-sm font-medium">{t.customer.name}</span><span className="block truncate text-xs text-slate-500">{t.title} · {dateLabel(t.start)}</span></span><TripStageBar stage={t.stage} compact /></Link></li>)}
      </Card>}
      {can("payment:view") && <Card title="Payments to collect" icon="wallet" count={payments.length} seeAll="/reports?report=ageing" empty="No overdue customer payments.">
        {payments.slice(0, 8).map(i => <Row key={i.id} href={i.href} title={i.title} detail={i.detail} tone="warning" />)}
      </Card>}
      {can("customer:view") && <Card title="Follow up today" icon="phone" count={followUps.length} seeAll="/sales" empty="No follow-ups due.">
        {followUps.slice(0, 8).map(i => <Row key={i.id} href={i.href} title={i.title} detail={i.detail} />)}
      </Card>}
      {can("ticketing:view") && <Card title="New online bookings" icon="globe" count={onlineRows.length} seeAll="/online-bookings" empty="No online bookings in the last 48 hours.">
        {onlineRows.slice(0, 8).map(b => <Row key={b.id} href={b.serviceCaseId ? `/trips/${b.serviceCaseId}` : `/ticketing/${b.id}`} title={`${b.customer.name} · ${b.bookingNo}`} detail={[b.sector, dateTimeLabel(b.createdAt)].filter(Boolean).join(" · ")} />)}
      </Card>}
      <Card title="Alerts" icon="bell" count={alerts.length} seeAll="/work/service-alerts" empty="No alerts right now.">
        {alerts.slice(0, 8).map(i => <Row key={i.id} href={i.href} title={i.title} detail={i.detail} tone={i.severity === "URGENT" ? "danger" : i.severity === "HIGH" ? "warning" : undefined} />)}
      </Card>
    </div>
  </div>;
}
