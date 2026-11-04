import CustomerMoments from "./CustomerMoments";
import WorkRefresh from "./WorkRefresh";
import Link from "next/link";
import { PageHeader, EmptyState } from "./ui";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import { readWork } from "@/lib/work-read";
import { workReport } from "@/lib/work-reports";
import { computePulse } from "@/lib/pulse";
import { taskScope } from "@/lib/work-engine";
import { dateTimeLabel, dayChipLabel } from "@/lib/dates";

export default async function WorkHome({ user, denied = false }: { user: SessionUser; denied?: boolean }) {
  const manager = user.permissions.includes("work:team"),
    services = [
      ...(user.permissions.includes("visa:create") ? ["VISA"] : []),
      ...(user.permissions.includes("ticketing:create")
        ? ["FLIGHT", "HOTEL", "STAY", "BUS", "TRAIN", "INSURANCE"]
        : []),
    ];
  const [data, report, pulse, priority] = await Promise.all([
    readWork(user, new URLSearchParams({ view: manager ? "all" : "mine" })),
    workReport(user, new URLSearchParams()),
    computePulse(prisma, user),
    prisma.task.findMany({
      where: {
        AND: [
          taskScope(user),
          { status: { in: ["OPEN", "IN_PROGRESS"] } },
          manager
            ? {
                OR: [
                  { unassigned: true },
                  { workState: "REVIEW" },
                  { dueAt: { lt: new Date() } },
                  { priority: "URGENT" },
                ],
              }
            : {
                OR: [
                  { ownerId: user.id, unassigned: false },
                  { reviewerId: user.id, workState: "REVIEW" },
                ],
              },
        ],
      },
      include: {
        owner: { select: { name: true } },
        serviceCase: { select: { caseNo: true,customer:{select:{name:true}} } },
      },
      orderBy: [
        { dueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: 6,
    }),
  ]);
  const serviceDeadlines = pulse.items
    .filter(
      (i) => i.kind === "PNR_DEADLINE" || i.kind === "APPOINTMENT_TOMORROW",
    )
    .slice(0, 3);
  const alerts = pulse.items
    .filter(
      (i) =>
        !i.kind.startsWith("TASK_") &&
        !i.kind.startsWith("LIST_CAPPED") &&
        !serviceDeadlines.some((d) => d.id === i.id),
    )
    .slice(0, 4);
  return (
    <div className="workspace-page work-desk">
      {denied && <p role="alert" className="form-error mb-5">Your role does not allow that page. Choose one of the sections in the menu.</p>}
      <PageHeader
        eyebrow={`${dayChipLabel(new Date())} · ${data.scope}`}
        title={manager ? "Agency overview" : "My day"}
        description={
          manager
            ? "See who needs an assignment, what needs your decision and which deadlines need attention."
            : "Your next actions, the cases behind them and the results you have recorded."
        }
        actions={
          <>
            {" "}
            <WorkRefresh />
            {services.length > 0 ? (
              <Link className="btn-primary" href="/trips/new">New trip</Link>
            ) : (
              <Link className="btn-primary" href="/work">
                {manager ? "Open work register" : "Open my work"}
              </Link>
            )}
          </>
        }
      />
      {manager&&<CustomerMoments user={user}/>}
      <div className="work-summary" aria-label="Daily work summary">
        {(manager
          ? [
              ["unassigned", "Unassigned work", data.stats.unassigned],
              ["overdue", "Overdue work", data.stats.overdue],
              ["review", "Awaiting review", data.stats.review],
              ["critical", "Critical deadlines", data.stats.critical],
            ]
          : [
              ["mine", "My open work", report.summary.open],
              ["overdue", "Overdue work", data.stats.overdue],
              ["review", "Awaiting review", data.stats.review],
              [
                "reports",
                "Completion events today",
                report.summary.completedEvents,
              ],
            ]
        ).map(([v, label, count]) => (
          <Link
            key={v}
            href={v === "reports" ? "/reports/work" : `/work?view=${v}`}
          >
            <span>{label}</span>
            <strong>{count}</strong>
            <span>View work →</span>
          </Link>
        ))}
      </div>
      {serviceDeadlines.length > 0 && (
        <section className="work-home-section work-service-deadlines">
          <header>
            <h2>Service deadlines to review</h2>
            <span className="work-muted">Supplier holds & appointments</span>
          </header>
          <div className="work-source-alerts">
            {serviceDeadlines.map((item) => (
              <Link href={item.href} key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="work-tag work-tag-overdue">Review →</span>
              </Link>
            ))}
          </div>
          <p className="work-muted p-4">
            Open the service register to review all holds and appointments.
          </p>
        </section>
      )}
      <div className="work-home-grid">
        <section
          className="work-home-section"
          aria-label="Work needing attention"
        >
          <header>
            <h2>{manager ? "Work needing attention" : "Your next actions"}</h2>
            <Link href="/work">Open work register →</Link>
          </header>
          {priority.map((t) => (
            <div className="work-home-row" key={t.id}>
              <div>
                <span>{t.serviceCase?.caseNo ?? "Internal / legacy"}{t.serviceCase?.customer?.name&&<> · {t.serviceCase.customer.name}</>}</span>
                <strong>{t.title}</strong>
                <span>
                  {t.unassigned ? "Needs an assignee" : t.owner.name} ·{" "}
                  {t.dueAt
                    ? dateTimeLabel(t.dueAt)
                    : "Set a deadline when assigning"}
                </span>
              </div>
              <Link href={`/work?task=${t.id}`}>
                {t.unassigned && user.permissions.includes("work:assign")
                  ? "Assign / plan"
                  : "View work"}
              </Link>
            </div>
          ))}
          {!priority.length && (
            <EmptyState
              title="No urgent work in your queue"
              description="Assigned actions and review requests will appear here."
            />
          )}
        </section>
        <section className="work-home-section" aria-label="Team workload">
          <header>
            <h2>{manager ? "Team workload" : "Today’s recorded outcomes"}</h2>
            <Link href="/reports/work">Work report →</Link>
          </header>
          {manager
            ? report.people.slice(0, 6).map((p) => (
                <div className="work-home-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {p.open} open · {p.overdue} overdue · {p.waiting} waiting
                      {p.id!=="unassigned"&&<> · {p.completions} completions today</>}
                    </span>
                  </div>
                  {p.id !== "unassigned" && (
                    <Link href={`/work?owner=${p.id}`}>View work</Link>
                  )}
                </div>
              ))
            : report.events
                .filter((e) => ["COMPLETE", "APPROVE"].includes(e.kind))
                .slice(0, 5)
                .map((e) => (
                  <div className="work-home-row" key={e.id}>
                    <div>
                      <span>{e.caseNo}</span>
                      <strong>{e.title}</strong>
                      <time className="block work-muted" dateTime={e.at}>{dateTimeLabel(e.at)}</time>
                    </div>
                    {e.canOpen?<Link href={`/work?task=${e.taskId}`}>View work</Link>:<span>Historical result</span>}
                  </div>
                ))}
          {!report.people.length && manager && (
            <p className="p-5">
              No recorded workload yet. Register a case and assign its service
              steps.
            </p>
          )}
          {!manager && !report.summary.completedEvents && (
            <p className="p-5">
              No recorded completion events today. Older completed tasks remain
              available in work history.
            </p>
          )}
        </section>
      </div>
      {manager&&<section className="work-home-section mt-6" aria-label="Recorded completions"><header><h2>Recorded completions today</h2><Link href="/work?view=done">All completed work →</Link></header>{report.events.filter(e=>["COMPLETE","APPROVE"].includes(e.kind)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,5).map(e=><div className="work-home-row" key={e.id}><div><span>{e.caseNo}</span><strong>{e.title}</strong><span>{e.assignee} · {e.kind==="APPROVE"?"Approved by":"Completed by"} {e.actor}</span><time className="block work-muted" dateTime={e.at}>{dateTimeLabel(e.at)}</time></div>{e.canOpen?<Link href={`/work?task=${e.taskId}`}>View work</Link>:<span>Historical result</span>}</div>)}{!report.summary.completedEvents&&<p className="p-5">No completion events recorded today. Completed work from earlier dates remains in the work register and reports.</p>}</section>}
      <section
        className="work-home-section mt-6"
        aria-label="Service exceptions"
      >
        <header>
          <h2>Customer and service exceptions</h2>
          <Link href="/work/service-alerts">View service alerts →</Link>
        </header>
        {alerts.map((i) => (
          <div key={i.id} className="work-home-row">
            <div>
              <strong>{i.title}</strong>
              <span>{i.detail}</span>
            </div>
            <Link href={i.href}>{i.actions.find(a=>a.href)?.label??"Review source"}</Link>
          </div>
        ))}
        {!alerts.length && (
          <p className="p-5">
            No service exceptions in the current attention shortlist.
          </p>
        )}
      </section>
      <p className="work-report-note">
        Work summaries use complete authorized records. Service exceptions are a
        working shortlist; specialist queues and reports contain full records.
      </p>
    </div>
  );
}
