import Link from "next/link";
import { buildAccountReport, type AccountReport } from "@/lib/account-reports";
import { teamLoad } from "@/lib/team-load";
import { istDayKey, dateLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import Icon, { type IconName } from "@/components/Icon";
import type { SessionUser } from "@/lib/session";

type Period = "today" | "week" | "month" | "custom";
const DAY = 86400000;

export function reportRange(period: Period, from?: string, to?: string, now = new Date()): { from: string; to: string } {
  const today = istDayKey(now);
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: istDayKey(new Date(now.getTime() - 6 * DAY)), to: today };
  if (period === "custom" && from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) return { from, to };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

const pick = (r: AccountReport | null, ...labels: string[]) => r ? labels.reduce((n, l) => n + (r.summary.find(s => s.label === l)?.value ?? 0), 0) : null;

export default async function ReportCards({ user, period, from, to }: { user: SessionUser; period: Period; from?: string; to?: string }) {
  const range = reportRange(period, from, to);
  const canSupplier = user.accessMode === "ALL" && user.permissions.includes("supplier:view");
  const run = async (report: string) => { try { return await buildAccountReport(user, new URLSearchParams({ report, ...range })); } catch { return null; } };
  const [sales, ageing, payables, operations, team] = await Promise.all([
    run("sales"), run("ageing"), canSupplier ? run("supplier-payables") : Promise.resolve(null), run("operations"),
    user.permissions.includes("task:view") ? teamLoad(user) : Promise.resolve([]),
  ]);
  const q = (report: string) => `report=${report}&from=${range.from}&to=${range.to}`;
  const excel = user.permissions.includes("export:data");
  const profit = pick(sales, "Costed confirmed booking margin", "Expected visa gross margin (confirmed costs)");
  const uncosted = pick(sales, "Uncosted confirmed bookings", "Visa records needing cost confirmation") ?? 0;
  const confirmed = pick(ageing, "Confirmed to collect"), unconfirmed = pick(ageing, "Not confirmed yet") ?? 0;
  const items = (n: number) => `${n} ${n === 1 ? "booking or visa needs" : "bookings and visas need"} a supplier cost`;
  const cards: { key: string; title: string; icon: IconName; value: string; tone?: string; note: string; open: string; excel?: string }[] = [
    { key: "profit", title: "Profit", icon: "wallet", value: profit === null ? "—" : profit === 0 && uncosted ? "Costs needed" : profit < 0 ? `Loss ${inrAmount(-profit)}` : inrAmount(profit), tone: profit === null || (profit === 0 && uncosted) ? "text-slate-600" : profit > 0 ? "text-emerald-700" : profit < 0 ? "text-rose-700" : "", note: uncosted ? `Counts only work with confirmed supplier costs. ${items(uncosted)} before its profit shows.` : "Bookings and visas with confirmed supplier costs. Each trip's profit is on the Trips list.", open: `/reports?${q("sales")}`, excel: `/api/reports/accounts?${q("sales")}&format=xlsx` },
    { key: "collect", title: "Payments to collect", icon: "wallet", value: inrAmount(confirmed), tone: "text-amber-800", note: unconfirmed ? `Confirmed work customers still owe. A further ${inrAmount(unconfirmed)} is on enquiries and quotes not yet confirmed.` : "Confirmed work customers still owe, oldest first.", open: `/reports?${q("ageing")}`, excel: `/api/reports/accounts?${q("ageing")}&format=xlsx` },
    ...(canSupplier ? [{ key: "payables", title: "Supplier payables", icon: "suppliers" as IconName, value: inrAmount(pick(payables, "Total open obligations")), note: "What you still owe suppliers, by due date.", open: `/reports?${q("supplier-payables")}`, excel: `/api/reports/accounts?${q("supplier-payables")}&format=xlsx` }] : []),
    { key: "sales", title: "Sales by staff", icon: "customers", value: inrAmount(pick(sales, "Confirmed booking value", "Visa work value")), note: "Confirmed bookings and visa work in the period, with the staff member on each row.", open: `/reports?${q("sales")}`, excel: `/api/reports/accounts?${q("sales")}&format=xlsx` },
    ...(team.length ? [{ key: "todos", title: "Staff to-dos", icon: "tasks" as IconName, value: `${team.reduce((n, r) => n + r.overdue, 0)} overdue`, tone: team.some(r => r.overdue) ? "text-rose-700" : "", note: `${team.reduce((n, r) => n + r.open, 0)} open to-dos across ${team.length} staff.`, open: "/reports/work" }] : []),
    { key: "travel", title: "Work & travel", icon: "plane", value: operations ? `${operations.totalRows} ${operations.totalRows === 1 ? "booking or visa" : "bookings and visas"}` : "—", note: "Opened in the period, with owner, travel dates and deadlines.", open: `/reports?${q("operations")}`, excel: `/api/reports/accounts?${q("operations")}&format=xlsx` },
  ];
  const periods: [Period, string][] = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["custom", "Custom"]];
  return <div className="workspace-page space-y-5">
    <PageHeader title="Reports" description={`${range.from === range.to ? dateLabel(range.from) : `${dateLabel(range.from)} to ${dateLabel(range.to)}`} · India time`} actions={<Link className="btn-primary" href={`/reports?${q("ageing")}`}>More reports</Link>} />
    <form className="flex flex-wrap items-end gap-2" action="/reports">
      <nav aria-label="Period" className="flex flex-wrap gap-2">{periods.filter(([p]) => p !== "custom").map(([p, label]) => <Link key={p} href={`/reports?period=${p}`} aria-current={period === p ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-sm ${period === p ? "border-teal-700 bg-teal-700 text-white" : "border-slate-200 bg-white"}`}>{label}</Link>)}</nav>
      <input type="hidden" name="period" value="custom" />
      <label className="text-sm">From <input type="date" name="from" defaultValue={range.from} required /></label>
      <label className="text-sm">To <input type="date" name="to" defaultValue={range.to} required /></label>
      <button className="btn-secondary">Show</button>
    </form>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(c => <section key={c.key} className="panel flex flex-col gap-2 p-5" aria-label={c.title}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Icon name={c.icon} size={16} className="text-teal-700" />{c.title}</h2>
        <p className={`text-2xl font-bold tracking-tight ${c.tone ?? ""}`}>{c.value}</p>
        <p className="flex-1 text-sm text-slate-600">{c.note}</p>
        <div className="flex gap-2"><Link className="btn-secondary" href={c.open}>Open</Link>{excel && c.excel && <a className="btn-secondary" href={c.excel}>Excel</a>}</div>
      </section>)}
    </div>
  </div>;
}
