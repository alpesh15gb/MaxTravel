"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, Field } from "./ui";
import { dateTimeLabel } from "@/lib/dates";
import { enumLabel } from "@/lib/labels";
import type { WorkReport } from "@/lib/work-reports";
const date = (s: string) =>
  new Date(new Date(s).getTime() + 19800000).toISOString().slice(0, 10);
export default function WorkReportClient({ report }: { report: WorkReport }) {
  const router = useRouter(),
    [from, setFrom] = useState(date(report.from)),
    [to, setTo] = useState(
      date(new Date(new Date(report.to).getTime() - 1).toISOString()),
    );
  const [owner, setOwner] = useState(report.ownerFilter),
    [service, setService] = useState(report.serviceFilter);
  useEffect(() => {
    setFrom(date(report.from));
    setTo(date(new Date(new Date(report.to).getTime() - 1).toISOString()));
    setOwner(report.ownerFilter);
    setService(report.serviceFilter);
  }, [report.from, report.to, report.ownerFilter, report.serviceFilter]);
  const range = () =>
    new URLSearchParams({
      ...(owner ? { owner } : {}),
      ...(service ? { service } : {}),
      from: new Date(`${from}T00:00:00+05:30`).toISOString(),
      to: new Date(
        new Date(`${to}T00:00:00+05:30`).getTime() + 86400000,
      ).toISOString(),
    });
  return (
    <div className="workspace-page work-desk">
      <PageHeader
        eyebrow={`${report.scope} · India time`}
        title="Work & team reports"
        description="Who owns unfinished work, what was delivered and where a decision or follow-up is needed."
        actions={
          <Link className="btn-primary" href="/work">
            Open work register
          </Link>
        }
      />
      <form
        className="work-filter-inputs my-6"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/reports/work?${range()}`);
        }}
      >
        <Field label="From date">
          <input
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Through date">
          <input
            type="date"
            required
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {report.canTeam && (
          <Field label="Assignee">
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All permitted colleagues</option>
              {report.ownerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Service">
          <select value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">All permitted services</option>
            {report.services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <button className="btn-secondary">Apply filters</button>
        {report.canExport && (
          <>
            <a
              className="btn-secondary"
              href={`/api/work/reports?${range()}&format=csv`}
            >
              Export dated events
            </a>
            <a
              className="btn-secondary"
              href={`/api/work/reports?${range()}&format=csv&dataset=backlog`}
            >
              Export complete backlog
            </a>
          </>
        )}
      </form>
      <div className="work-summary">
        {[
          ["Current open work", report.summary.open],
          ["Current overdue work", report.summary.overdue],
          ["Completion events in period", report.summary.completedEvents],
          ["Distinct tasks completed", report.summary.distinctCompletedTasks],
        ].map(([l, v]) => (
          <div key={l} className="workspace-stat">
            <span>{l}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="work-report-note">
        {report.basis} Refreshed {dateTimeLabel(report.checkedAt)}.{" "}
        {report.coverage.legacy} legacy records have incomplete historical
        coverage.
      </p>
      <section className="panel p-5 mb-6">
        <h2 className="text-lg font-semibold mb-3">
          Workload and recorded outcomes by colleague
        </h2>
        <div className="work-report-scroll">
          <table className="work-report-table">
            <thead>
              <tr>
                {[
                  "Colleague",
                  "Open now",
                  "Overdue now",
                  "Waiting now",
                  "Review now",
                  "Completions",
                  "On original deadline",
                  "Returned",
                ].map((s) => (
                  <th key={s} scope="col">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.id === "unassigned" ? (
                      p.name
                    ) : (
                      <Link
                        href={`/work?owner=${p.id}${report.serviceFilter ? `&service=${report.serviceFilter}` : ""}`}
                      >
                        {p.name}
                      </Link>
                    )}
                  </td>
                  <td>{p.open}</td>
                  <td>{p.overdue}</td>
                  <td>{p.waiting}</td>
                  <td>{p.review}</td>
                  <td>{p.completions}</td>
                  <td>
                    {p.timedCompletions
                      ? `${p.onTime} / ${p.timedCompletions}`
                      : "Unknown / no dated completions"}
                  </td>
                  <td>{p.returns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="work-report-note">
          Current workload and dated completions are different measures.
          Completion events retain the assignee at the event. Task volume alone
          is not a productivity score.
        </p>
      </section>
      <section className="panel p-5 mb-6">
        <h2 className="text-lg font-semibold">
          Work due in the selected period
        </h2>
        <p className="work-report-note">
          {report.summary.due} tasks by their current due dates. Cancelled work
          is separate from completed work.
        </p>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(report.cohort).map(([s, n]) => (
            <Link
              key={s}
              href={`/work?${new URLSearchParams({ view: "records", state: s, dueFrom: report.from, dueTo: report.to, ...(report.ownerFilter ? { owner: report.ownerFilter } : {}), ...(report.serviceFilter ? { service: report.serviceFilter } : {}) })}`}
            >
              {enumLabel(s)}: <strong>{n}</strong>
            </Link>
          ))}
        </div>
      </section>
      <section className="panel p-5 mb-6">
        <h2 className="text-lg font-semibold">Recorded work events</h2>
        <div className="work-report-scroll">
          <table className="work-report-table">
            <thead>
              <tr>
                {[
                  "At",
                  "Case / action",
                  "Event",
                  "Assignee at event",
                  "Recorded by",
                  "Result / reason",
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.events.slice(0, 100).map((e) => (
                <tr key={e.id}>
                  <td>{dateTimeLabel(e.at)}</td>
                  <td>
                    <span>{e.caseNo}</span>
                    <br />
                    {e.canOpen ? (
                      <Link href={`/work?task=${e.taskId}`}>{e.title}</Link>
                    ) : (
                      <span>{e.title} · previous assignment</span>
                    )}
                  </td>
                  <td>{enumLabel(e.kind)}</td>
                  <td>{e.assignee}</td>
                  <td>{e.actor}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="work-report-note">
          Showing {Math.min(report.events.length, 100)} of{" "}
          {report.events.length} events. The dated export includes the complete
          matching set.
        </p>
      </section>
      <section className="panel p-5">
        <h2 className="text-lg font-semibold">Unfinished work</h2>
        <div className="work-report-scroll">
          <table className="work-report-table">
            <thead>
              <tr>
                {[
                  "Case / action",
                  "Assignee",
                  "State",
                  "Due",
                  "Waiting on / next check",
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.backlog.slice(0, 100).map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.caseNo}
                    <br />
                    <Link href={`/work?task=${t.id}`}>{t.title}</Link>
                  </td>
                  <td>{t.assignee}</td>
                  <td>{enumLabel(t.state)}</td>
                  <td>
                    {t.dueAt ? dateTimeLabel(t.dueAt) : "Missing deadline"}
                  </td>
                  <td>
                    {t.waitingReason ? enumLabel(t.waitingReason) : "—"}
                    {t.nextCheckAt && ` · ${dateTimeLabel(t.nextCheckAt)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="work-report-note">
          Showing {Math.min(report.backlog.length, 100)} of{" "}
          {report.backlog.length} open tasks. Open the work register for
          paginated work or export the complete backlog.
        </p>
      </section>
    </div>
  );
}
