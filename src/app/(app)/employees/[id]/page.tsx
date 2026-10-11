import { enumLabel } from "@/lib/labels";
import { dateLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("employee:view");
  const { id } = await params;
  const e = await prisma.user.findUnique({
    where: { id },
    include: { role: true, branch: true },
  });
  if (!e || (user.accessMode === "BRANCH" && e.branchId !== user.branchId) || (user.accessMode === "ASSIGNED" && e.id !== user.id)) notFound();

  const [tasks, visaCases, bookings] = await Promise.all([
    prisma.task.findMany({ where: { ownerId: id, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { dueAt: "asc" }, take: 10 }),
    prisma.visaCase.findMany({ where: { ownerId: id, stage: { key: { notIn: ["CLOSED", "DELIVERED"] } } }, include: { stage: true, customer: { select: { name: true } } }, take: 10 }),
    prisma.booking.findMany({ where: { ownerId: id, status: { notIn: ["CANCELLED", "VOID", "REFUNDED"] } }, include: { customer: { select: { name: true } } }, take: 10 }),
  ]);

  const hr = can(user.permissions, "hr:view");

  return (
    <div className="workspace-page max-w-5xl space-y-5">
      <PageHeader title={e.name} description={`${e.role.name} · ${e.branch?.name ?? "All branches"} · ${e.employeeCode}`} actions={<Link href="/employees" className="btn-secondary">Back to team</Link>} />
      <p className="text-sm text-slate-500">Joined {e.joinedOn ? dateLabel(e.joinedOn) : "Not set"}</p>

      <section className="panel p-5">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Contact</h3>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          <div><span className="text-slate-500 text-xs block">Email</span>{e.email}</div>
          <div><span className="text-slate-500 text-xs block">Phone</span>{e.phone}</div>
        </div>
      </section>

      <section className="panel p-5">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">HR information {hr ? "" : "(restricted)"}</h3>
        {hr ? (
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500 text-xs block">Annual salary (CTC)</span>{e.salary != null ? inrAmount(Math.round(e.salary)) : "—"}</div>
            <div><span className="text-slate-500 text-xs block">Bank account</span><span className="font-mono">{e.bankAccount ?? "—"}</span></div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Salary and bank details are visible only to roles with HR permission.</p>
        )}
      </section>

      <section className="panel p-5">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Current workload · latest 10 per category</h3>
        <div className="grid sm:grid-cols-3 gap-3 text-sm mb-3">
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><span className="text-xs text-slate-500 block">Open tasks</span>{tasks.length}</div>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><span className="text-xs text-slate-500 block">Active visa cases</span>{visaCases.length}</div>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><span className="text-xs text-slate-500 block">Live bookings</span>{bookings.length}</div>
        </div>
        <div className="space-y-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="text-xs bg-white rounded-lg px-3 py-2 flex justify-between">
              <span>{t.title}</span>
              <span className="text-slate-500">{t.priority}{t.dueAt ? ` · due ${dateLabel(t.dueAt)}` : ""}</span>
            </div>
          ))}
          {visaCases.map((v) => (
            <div key={v.id} className="text-xs bg-white rounded-lg px-3 py-2 flex justify-between">
              <Link href={`/visa/${v.id}`} className="hover:text-teal-700">{v.caseNo} — {v.customer.name}</Link>
              <span className="text-slate-500">{v.stage.name}</span>
            </div>
          ))}
          {bookings.map((b) => (
            <div key={b.id} className="text-xs bg-white rounded-lg px-3 py-2 flex justify-between">
              <Link href={`/ticketing/${b.id}`} className="hover:text-teal-700">{b.bookingNo} — {b.customer.name}</Link>
              <span className="text-slate-500">{enumLabel(b.status)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
