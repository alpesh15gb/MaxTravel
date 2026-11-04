"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import WorkSourceChoice from "./WorkSourceChoice";
import Modal from "./Modal";
import Icon from "./Icon";
import { PageHeader, Field, EmptyState, Status } from "./ui";
import type { WorkData, WorkDetail, WorkRow } from "@/lib/work-read";
import { WAITING_REASONS, resultsForService } from "@/lib/work-config";
import { dateTimeLabel } from "@/lib/dates";
import { enumLabel } from "@/lib/labels";
import { assignmentUnavailable } from "@/lib/work-assignment";

export const workStateLabel = (s: string) =>
  ({
    TODO: "To do",
    IN_PROGRESS: "In progress",
    WAITING: "Waiting",
    REVIEW: "Awaiting review",
    DONE: "Done",
    CANCELLED: "Cancelled",
  })[s] ?? s;
const stamp = (v: string | null) => (v ? dateTimeLabel(v) : "Not scheduled");
const local = (v: string | null) =>
  v
    ? new Date(new Date(v).getTime() + 19800000).toISOString().slice(0, 16)
    : "";
const iso = (v: FormDataEntryValue | null) =>
  v ? new Date(String(v) + "+05:30").toISOString() : null;
async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal, cache: "no-store" }),
    b = await r.json();
  if (!r.ok) throw Error(b.error ?? "Could not load this work.");
  return b;
}

export default function WorkDesk({
  initialData,
  caseId,
  embedded = false,
}: {
  initialData: WorkData;
  caseId?: string;
  embedded?: boolean;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    [data, setData] = useState(initialData),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [create, setCreate] = useState(params.get("new") === "1"),
    [selected, setSelected] = useState<string[]>([]),
    [board, setBoard] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [bulk, setBulk] = useState(false),
    [plan, setPlan] = useState<{ caseId: string; service: string } | null>(
      null,
    );
  useEffect(() => {
    if (params.get("new") === "1") setCreate(true);
  }, [params]);
  const closeCreate = () => {
    setCreate(false);
    if (params.get("new") === "1") {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(window.location.pathname + (next.size ? "?" + next.toString() : ""), { scroll: false });
    }
  };
  useEffect(() => {
    const m = window.matchMedia("(min-width: 701px)");
    const resize = () => setFiltersOpen(m.matches);
    resize();
    m.addEventListener("change", resize);
    return () => m.removeEventListener("change", resize);
  }, []);
  const key = params.toString(),
    taskId = params.get("task"),
    view =
      params.get("view") ??
      (embedded || data.permissions.team ? "all" : "mine"),
    request = useRef<AbortController | null>(null);
  const query = useCallback(() => {
    const q = new URLSearchParams(key);
    q.delete("task");
    q.delete("tab");
    if (caseId) {
      q.set("case", caseId);
      if (!q.has("view")) q.set("view", "all");
    }
    return q;
  }, [key, caseId]);
  const load = useCallback(async () => {
    request.current?.abort();
    const c = new AbortController();
    request.current = c;
    setRefreshing(true);
    setError("");
    try {
      const d = await readJson<WorkData>(`/api/work?${query()}`, c.signal);
      if (!c.signal.aborted) setData(d);
    } catch (e) {
      if (!c.signal.aborted) {
        const message = e instanceof Error ? e.message : "Could not refresh.";
        setError(message);
        return message;
      }
    } finally {
      if (!c.signal.aborted) setRefreshing(false);
    }
  }, [query]);
  useEffect(() => {
    void load();
    setSelected([]);
    return () => request.current?.abort();
  }, [load]);
  function change(name: string, value: string) {
    const q = new URLSearchParams(key);
    q.delete("page");
    q.delete("task");
    if (value) q.set(name, value);
    else q.delete(name);
    router.push(`${embedded ? `/trips/${caseId}` : "/work"}?${q}`, {
      scroll: false,
    });
  }
  function openTask(id: string | null) {
    const q = new URLSearchParams(key);
    if (id) q.set("task", id);
    else q.delete("task");
    router.push(`${embedded ? `/trips/${caseId}` : "/work"}?${q}`, {
      scroll: false,
    });
  }
  function saved() {
    void load();
    router.refresh();
  }
  const views = [
    ...(embedded && !data.permissions.team ? [["all", "Case work"]] : []),
    ...(data.permissions.team
      ? [
          ["all", "Active work"],
          ["unassigned", "Unassigned"],
        ]
      : []),
    ["mine", "My work"],
    ["today", "Due through today"],
    ["overdue", "Overdue"],
    ["review", "Review"],
    ["waiting", "Waiting"],
    ["done", "Done"],
    ["records", "All states"],
    ...(data.permissions.assign ? [["legacy", "Needs case link"]] : []),
  ];
  const caseRecord = data.cases.find((c) => c.id === caseId);
  return (
    <div className={embedded ? "work-desk" : "workspace-page work-desk"}>
      {!embedded ? (
        <PageHeader
          eyebrow={data.scope}
          title={data.permissions.team ? "Team work" : "My work"}
          description="Assign the next action, record the result and keep the customer’s case moving."
          actions={
            data.permissions.create && (
              <button className="btn-primary" onClick={() => setCreate(true)}>
                <Icon name="plus" size={17} />
                Add to-do
              </button>
            )
          }
        />
      ) : (
        <div className="work-toolbar">
          <div>
            <h2>Case work</h2>
            <p>One coordinator, clear steps and individual responsibility.</p>
          </div>
          {data.permissions.create && !data.caseClosed && (
            <button className="btn-primary" onClick={() => setCreate(true)}>
              Add to-do
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button className="btn-secondary ml-3" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {!embedded && (
        <div className="work-summary" aria-label="Work summary">
          {(
            [
              ["unassigned", "Unassigned", data.stats.unassigned],
              ["overdue", "Overdue", data.stats.overdue],
              ["review", "Awaiting review", data.stats.review],
              ["critical", "Critical deadlines", data.stats.critical],
            ] as const
          ).map(([v, label, count]) => (
            <Link
              href={`/work?${(() => {
                const q = query();
                q.set("view", v);
                q.delete("page");
                return q;
              })()}`}
              key={v}
            >
              <span>{label}</span>
              <strong>{count}</strong>
              <Icon name="arrow" size={16} />
            </Link>
          ))}
        </div>
      )}
      {embedded && data.permissions.assign && !data.caseClosed && (
        <details className="work-service-plan-disclosure">
          <summary>Service plans & additional services</summary>
          <div className="work-service-plans">
            <span>Service work plan</span>
            {data.services.map((service) => (
              <button
                key={service}
                className="btn-secondary"
                onClick={() => setPlan({ caseId: caseId!, service })}
              >
                {caseRecord?.serviceWork.some((w) => w.service === service)
                  ? `Plan ${service.toLowerCase()}`
                  : `Add ${service.toLowerCase()} service`}
              </button>
            ))}
            <p>
              Preview steps and deadlines before applying. Existing steps keep
              their original settings.
            </p>
          </div>
        </details>
      )}
      <div className="work-filter-bar">
        <label className="work-mobile-view">
          Work view
          <select value={view} onChange={(e) => change("view", e.target.value)}>
            {views.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <nav className="work-desktop-views" aria-label="Work views">
          {views.map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-current={view === v ? "page" : undefined}
              className={view === v ? "work-view-active" : ""}
              onClick={() => change("view", v)}
            >
              {label}
            </button>
          ))}
        </nav>
        <details
          className="work-filter-disclosure"
          open={filtersOpen}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
        >
          <summary>Search & filters</summary>
          <div className="work-filter-inputs">
            <label>
              <span>Search work</span>
              <input
                className="control"
                type="search"
                defaultValue={params.get("q") ?? ""}
                placeholder="Max ID, action or colleague"
                onKeyDown={(e) => {
                  if (e.key === "Enter") change("q", e.currentTarget.value);
                }}
                onBlur={(e) => {
                  if (e.target.value !== (params.get("q") ?? ""))
                    change("q", e.target.value);
                }}
              />
            </label>
            <label>
              <span>Service</span>
              <select
                className="control"
                value={params.get("service") ?? ""}
                onChange={(e) => change("service", e.target.value)}
              >
                <option value="">All services</option>
                {["VISA", "FLIGHT", "HOTEL"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {data.permissions.team && (
              <label>
                <span>Assignee</span>
                <select
                  className="control"
                  value={params.get("owner") ?? ""}
                  onChange={(e) => change("owner", e.target.value)}
                >
                  <option value="">Everyone</option>
                  {data.people
                    .filter((p) => p.canWork)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button
              className="btn-secondary"
              disabled={refreshing}
              onClick={() => void load()}
              aria-label="Refresh work"
            >
              <Icon name="refresh" size={16} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="btn-secondary"
              aria-pressed={board}
              onClick={() => setBoard((v) => !v)}
            >
              {board ? "List view" : "Board view"}
            </button>
          </div>
        </details>
      </div>
      <div className="work-list-heading">
        <p>
          {data.total} matching work items · {data.scope}
        </p>
        <div>
          {selected.length > 0 && data.permissions.assign && (
            <button className="btn-secondary" onClick={() => setBulk(true)}>
              Assign {selected.length} selected
            </button>
          )}
          {!embedded && (
            <Link href="/reports/work" className="btn-secondary">
              Work reports
              <Icon name="arrow" size={15} />
            </Link>
          )}
          {!embedded && data.permissions.configure && (
            <Link href="/work/settings" className="btn-secondary">
              Templates & rules
            </Link>
          )}
        </div>
      </div>
      {!data.rows.length ? (
        <EmptyState
          title="No work in this view"
          description="Change the filters or add a case-linked action."
        />
      ) : board ? (
        <div className="work-board">
          {["TODO", "IN_PROGRESS", "WAITING", "REVIEW", "DONE", "CANCELLED"]
            .filter((s) => data.rows.some((t) => t.state === s))
            .map((s) => (
              <section key={s}>
                <h2>{workStateLabel(s)}</h2>
                {data.rows
                  .filter((t) => t.state === s)
                  .map((t) => (
                    <button
                      className="work-board-item"
                      key={t.id}
                      onClick={() => openTask(t.id)}
                    >
                      <span>{t.case?.caseNo ?? "Internal / legacy"}</span>
                      <strong>{t.title}</strong>
                      <span>
                        {t.unassigned ? "Unassigned" : t.owner.name} ·{" "}
                        {stamp(t.dueAt)}
                      </span>
                    </button>
                  ))}
              </section>
            ))}
        </div>
      ) : (
        <div className="work-register" aria-label="To-dos">
          <div className="work-register-head" aria-hidden="true">
            <span>Case / action</span>
            <span>Assignee</span>
            <span>Due / next check</span>
            <span>Status</span>
            <span>Open</span>
          </div>
          {data.rows.map((t) => (
            <article key={t.id} className="work-register-row">
              <div className="work-record-main">
                {data.permissions.assign && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.title}`}
                    checked={selected.includes(t.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, t.id]
                          : ids.filter((id) => id !== t.id),
                      )
                    }
                  />
                )}
                <div>
                  <span className="work-kicker">
                    {t.case ? (
                      <Link href={`/trips/${t.case.id}`}>{t.case.caseNo}</Link>
                    ) : t.customer ? (
                      "Needs case link"
                    ) : (
                      "Internal work"
                    )}
                    {t.serviceWork && ` · ${t.serviceWork.service}`}
                  </span>
                  <button
                    className="work-record-title"
                    onClick={() => openTask(t.id)}
                  >
                    {t.title}
                  </button>
                  {t.customer && <p>{t.customer.name}</p>}
                  {t.prerequisite && !t.prerequisite.done && (
                    <p className="work-note">After: {t.prerequisite.title}</p>
                  )}
                </div>
              </div>
              <div>
                <span className="work-mobile-label">Assignee</span>
                <strong>{t.unassigned ? "Unassigned" : t.owner.name}</strong>
                {t.unassigned && <p>Coordinator to allocate</p>}
              </div>
              <div>
                <span className="work-mobile-label">Due</span>
                <span
                  className={
                    t.dueAt &&
                    new Date(t.dueAt) < new Date() &&
                    !["DONE", "CANCELLED"].includes(t.state)
                      ? "work-late"
                      : ""
                  }
                >
                  {stamp(t.dueAt)}
                </span>
                {t.nextCheckAt && <p>Check: {stamp(t.nextCheckAt)}</p>}
                {t.hardDeadline && <p>Hard service deadline</p>}
              </div>
              <div>
                <Status
                  tone={
                    t.state === "DONE"
                      ? "success"
                      : t.state === "WAITING"
                        ? "warning"
                        : t.state === "REVIEW"
                          ? "info"
                          : "neutral"
                  }
                >
                  {workStateLabel(t.state)}
                </Status>
                {t.waitingReason && <p>{enumLabel(t.waitingReason)}</p>}
              </div>
              <button className="btn-secondary" onClick={() => openTask(t.id)}>
                {t.unassigned && data.permissions.assign
                  ? "Assign / plan"
                  : "Open work"}
                <Icon name="arrow" size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="work-pagination">
        <p>
          Showing {data.total ? (data.page - 1) * data.pageSize + 1 : 0}–
          {Math.min(data.total, data.page * data.pageSize)} of {data.total}.
          Counts include the complete matching set.
        </p>
        <div>
          <button
            className="btn-secondary"
            disabled={data.page <= 1}
            onClick={() => change("page", String(data.page - 1))}
          >
            Previous
          </button>
          <button
            className="btn-secondary"
            disabled={data.page * data.pageSize >= data.total}
            onClick={() => change("page", String(data.page + 1))}
          >
            Next
          </button>
        </div>
      </div>
      {taskId && (
        <WorkItem
          key={taskId}
          id={taskId}
          data={data}
          close={() => openTask(null)}
          saved={saved}
          plan={setPlan}
        />
      )}
      {create && data.permissions.create && (
        <CreateWorkDialog
          data={data}
          caseId={caseId}
          refreshPeople={load}
          refreshing={refreshing}
          close={closeCreate}
          saved={saved}
        />
      )}
      {plan && (
        <PlanDialog
          data={data}
          selection={plan}
          close={() => setPlan(null)}
          saved={saved}
        />
      )}
      {bulk && (
        <BulkDialog
          data={data}
          selected={data.rows.filter((t) => selected.includes(t.id))}
          close={() => setBulk(false)}
          saved={() => {
            setSelected([]);
            saved();
          }}
        />
      )}
    </div>
  );
}

function useWorkWrite() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    pending = useRef<{ url: string; body: unknown } | null>(null);
  async function write(
    url: string,
    body: unknown,
    done: (value?: unknown) => void,
  ) {
    if (busy) return;
    const send = pending.current ?? { url, body };
    pending.current = send;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(send.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(send.body),
        }),
        d = await r.json();
      if (!r.ok) {
        if (r.status < 500) {
          pending.current = null;
          setUncertain(false);
        } else setUncertain(true);
        throw Error(d.error ?? "Could not save work.");
      }
      pending.current = null;
      setUncertain(false);
      done(d);
    } catch (e) {
      if (pending.current) setUncertain(true);
      setError(
        e instanceof Error
          ? e.message
          : "Connection interrupted. Retry this same action.",
      );
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, uncertain, write };
}
function SaveState({
  error,
  uncertain,
}: {
  error: string;
  uncertain: boolean;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {uncertain && (
        <p role="status">
          The outcome is unknown. Retry the same action to recover its
          acknowledgement safely. Your original details are locked.
        </p>
      )}
    </>
  );
}

function WorkItem({
  id,
  data,
  close,
  saved,
  plan,
}: {
  id: string;
  data: WorkData;
  close: () => void;
  saved: () => void;
  plan: (v: { caseId: string; service: string }) => void;
}) {
  const [detail, setDetail] = useState<WorkDetail | null>(null),
    [loadError, setLoadError] = useState(""),
    [action, setAction] = useState(""),
    w = useWorkWrite();
  useEffect(() => {
    const c = new AbortController();
    readJson<WorkDetail>(`/api/work/${id}`, c.signal)
      .then(setDetail)
      .catch((e) => {
        if (!c.signal.aborted) setLoadError(e.message);
      });
    return () => c.abort();
  }, [id]);
  if (!detail)
    return (
      <WorkModal title="Work item" onClose={close}>
        {loadError ? (
          <p role="alert">{loadError}</p>
        ) : (
          <p role="status">Loading work…</p>
        )}
      </WorkModal>
    );
  const t = detail.task,
    mine = t.owner.id === data.userId && !t.unassigned,
    editable = data.permissions.edit && (mine || data.permissions.assign),
    reviewable =
      data.permissions.review &&
      t.owner.id !== data.userId &&
      (t.reviewerId === data.userId || data.permissions.assign),
    closed = ["DONE", "CANCELLED"].includes(t.state);
  const actions: { key: string; label: string }[] = [];
  if (editable && !t.unassigned) {
    if (t.state === "TODO") actions.push({ key: "START", label: "Start work" });
    if (t.state === "WAITING")
      actions.push({ key: "RESUME", label: "Resume work" });
    if (["TODO", "IN_PROGRESS"].includes(t.state)) {
      actions.push(
        {
          key: t.requiresReview ? "SUBMIT" : "COMPLETE",
          label: t.requiresReview ? "Submit for review" : "Complete work",
        },
        { key: "WAIT", label: "Waiting on something" },
      );
    }
  }
  if (reviewable && t.state === "REVIEW")
    actions.push(
      { key: "APPROVE", label: "Approve result" },
      { key: "RETURN", label: "Return with feedback" },
    );
  if (editable && !closed) actions.push({ key: "EDIT", label: "Edit work" });
  if (data.permissions.assign) {
    if (!closed)
      actions.push(
        { key: "ASSIGN", label: "Assign / reassign" },
        { key: "CANCEL", label: "Cancel work" },
        { key: "WAIVE", label: "Waive required step" },
      );
    else {
      actions.push({ key: "REOPEN", label: "Reopen work" });
      if (t.state === "CANCELLED" && t.required && !t.waived)
        actions.push({ key: "WAIVE", label: "Waive cancelled requirement" });
    }
  }
  const selectedAction = actions.find((a) => a.key === action),
    needsNote = [
      "COMPLETE",
      "SUBMIT",
      "WAIT",
      "RETURN",
      "REOPEN",
      "CANCEL",
      "WAIVE",
    ].includes(action);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      requestKey: crypto.randomUUID(),
      version: t.version,
      action,
      note: String(f.get("note") ?? ""),
    };
    if (action === "WAIT")
      Object.assign(body, {
        waitingReason: f.get("waitingReason"),
        nextCheckAt: iso(f.get("nextCheckAt")),
      });
    if (["ASSIGN", "EDIT"].includes(action)) {
      if (data.permissions.assign) {
        const due = iso(f.get("dueAt"));
        if (due !== t.dueAt) body.dueAt = due;
        const owner = String(f.get("ownerId") ?? "") || null;
        if (action === "ASSIGN" || owner !== (t.unassigned ? null : t.owner.id))
          body.ownerId = owner;
        body.requiresReview = f.get("requiresReview") === "on";
        body.reviewerId = String(f.get("reviewerId") ?? "") || null;
      }
      if (action === "EDIT") {
        if (f.get("clearLegacySources") === "on") {
          body.bookingId = null;
          body.visaCaseId = null;
        }
        body.title = f.get("title");
        body.details = f.get("details");
        body.priority = f.get("priority");
        if (t.case && f.has("bookingId")) {
          body.bookingId = String(f.get("bookingId") ?? "") || null;
          body.visaCaseId = String(f.get("visaCaseId") ?? "") || null;
        }
        if (
          data.permissions.assign &&
          !t.case &&
          t.customer &&
          f.get("caseId")
        ) {
          body.caseId = f.get("caseId");
          body.serviceWorkId = f.get("serviceWorkId");
        }
      }
    }
    await w.write(`/api/work/${id}`, body, () => {
      saved();
      close();
    });
  }
  return (
    <WorkModal
      busy={w.busy || w.uncertain}
      title={t.title}
      onClose={() => {
        if (!w.busy && !w.uncertain) close();
      }}
    >
      <div className="work-item-detail">
        <p className="work-kicker">
          {t.case?.caseNo ?? "Internal / legacy"} ·{" "}
          {t.serviceWork?.service ?? "General work"}
        </p>
        <div className="work-detail-meta">
          <Status tone="info">{workStateLabel(t.state)}</Status>
          <span>{t.unassigned ? "Unassigned" : t.owner.name}</span>
          <span>Due {stamp(t.dueAt)}</span>
        </div>
        {t.details && <p className="whitespace-pre-wrap">{t.details}</p>}
        {t.prerequisite && !t.prerequisite.done && (
          <p className="form-error">First complete: {t.prerequisite.title}</p>
        )}
        {t.waitingReason && (
          <p>
            Waiting for {enumLabel(t.waitingReason)} · next check{" "}
            {stamp(t.nextCheckAt)}
          </p>
        )}
        {t.outcome && (
          <section>
            <h3>Recorded result</h3>
            <p className="whitespace-pre-wrap">{t.outcome}</p>
          </section>
        )}
        <div className="work-context-links">
          {t.case && <Link href={`/trips/${t.case.id}`}>Open case</Link>}
          {t.bookingId && (
            <Link href={`/ticketing/${t.bookingId}`}>Open linked booking</Link>
          )}
          {t.visaCaseId && (
            <Link href={`/visa/${t.visaCaseId}`}>
              Open linked visa application
            </Link>
          )}
          {t.case &&
            t.sourceKey?.startsWith("plan:") &&
            data.permissions.assign && (
              <button
                className="btn-secondary"
                onClick={() => {
                  plan({ caseId: t.case!.id, service: t.serviceWork!.service });
                  close();
                }}
              >
                Plan service steps
              </button>
            )}
        </div>
        {actions.length > 0 && (
          <div className="work-actions" aria-label="Work actions">
            {!action &&
              actions.map((a, i) => (
                <button
                  key={a.key}
                  className={i === 0 ? "btn-primary" : "btn-secondary"}
                  disabled={w.busy || w.uncertain}
                  onClick={() => setAction(a.key)}
                >
                  {a.label}
                </button>
              ))}
          </div>
        )}
        {selectedAction && (
          <form onSubmit={submit} className="work-action-form">
            <h3>{selectedAction.label}</h3>
            <fieldset disabled={w.busy || w.uncertain} className="space-y-4">
              {action === "WAIT" && (
                <>
                  <Field label="Waiting on *">
                    <select
                      name="waitingReason"
                      required
                      defaultValue="CUSTOMER"
                    >
                      {WAITING_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {enumLabel(r)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Next follow-up *" hint="India time (IST)">
                    <input type="datetime-local" name="nextCheckAt" required />
                  </Field>
                </>
              )}
              {["ASSIGN", "EDIT"].includes(action) && (
                <>
                  {action === "EDIT" && (
                    <>
                      <Field label="Action title *">
                        <input
                          name="title"
                          defaultValue={t.title}
                          required
                          maxLength={200}
                        />
                      </Field>
                      <Field label="Instructions">
                        <textarea
                          name="details"
                          defaultValue={t.details ?? ""}
                          maxLength={3000}
                        />
                      </Field>
                      <Field label="Priority">
                        <select name="priority" defaultValue={t.priority}>
                          {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </Field>
                    </>
                  )}
                  {data.permissions.assign && (
                    <AssignmentFields
                      data={data}
                      service={t.serviceWork?.service}
                      branchId={t.branchId}
                      ownerId={t.unassigned ? null : t.owner.id}
                      dueAt={t.dueAt}
                      reviewerId={t.reviewerId}
                      requiresReview={t.requiresReview}
                    />
                  )}
                  {action === "EDIT" &&
                    !t.case &&
                    (t.bookingId || t.visaCaseId) && (
                      <label className="flex gap-3 items-center">
                        <input type="checkbox" name="clearLegacySources" />
                        Disconnect conflicting legacy record references before
                        filing this work. Source records remain intact.
                      </label>
                    )}
                  {action === "EDIT" && t.case && (
                    <>
                      <Field label="Linked booking">
                        <select
                          name="bookingId"
                          defaultValue={t.bookingId ?? ""}
                        >
                          <option value="">No booking linked</option>
                          {detail.sources.bookings.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bookingNo} · {b.status}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Linked visa application">
                        <select
                          name="visaCaseId"
                          defaultValue={t.visaCaseId ?? ""}
                        >
                          <option value="">No application linked</option>
                          {detail.sources.visas.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.caseNo}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  )}
                  {action === "EDIT" &&
                    !t.case &&
                    t.customer &&
                    data.permissions.assign && (
                      <CaseFields data={data} customerId={t.customer.id} />
                    )}
                </>
              )}
              <Field
                label={needsNote ? "Result / reason *" : "Note / reason"}
                hint="Explain deadline changes, blockers and review decisions. Business outcomes must be recorded in their source screens."
              >
                <textarea
                  name="note"
                  required={needsNote}
                  maxLength={3000}
                  rows={3}
                />
              </Field>
            </fieldset>
            <SaveState error={w.error} uncertain={w.uncertain} />
            <button className="btn-primary" disabled={w.busy}>
              {w.busy
                ? "Saving…"
                : w.uncertain
                  ? "Retry same action"
                  : `Save: ${selectedAction.label.toLowerCase()}`}
            </button>
          </form>
        )}
        <section className="work-event-history">
          <h3>Work history</h3>
          {!t.workflowTracked && (
            <p>
              Legacy record: earlier assignment and review history is unknown.
            </p>
          )}
          <ol>
            {detail.events.map((e) => (
              <li key={e.id}>
                <strong>
                  {enumLabel(e.kind)} · {e.actorName}
                </strong>
                <p className="whitespace-pre-wrap">{e.detail}</p>
                <small>
                  {stamp(e.at)} · {e.assigneeName ?? "Unassigned"}
                </small>
              </li>
            ))}
          </ol>
          <p className="work-note">
            Latest 100 events. Full dated management history is available in
            work reports.
          </p>
        </section>
      </div>
    </WorkModal>
  );
}

function AssignmentFields({
  data,
  service,
  branchId,
  ownerId,
  dueAt,
  reviewerId,
  requiresReview,
  assignmentOnly = false,
}: {
  data: WorkData;
  service?: string;
  branchId?: string | null;
  ownerId: string | null;
  dueAt: string | null;
  reviewerId?: string | null;
  requiresReview?: boolean;
  assignmentOnly?: boolean;
}) {
  const [owner, setOwner] = useState(ownerId ?? ""),
    [review, setReview] = useState(Boolean(requiresReview));
  const selectRef = useRef<HTMLSelectElement>(null);
  const selectedPerson = data.people.find((p) => p.id === owner);
  const ownerIssue = !owner ? null : selectedPerson
    ? assignmentUnavailable(selectedPerson, service, branchId)
    : "This colleague is no longer available. Choose another assignee.";
  useEffect(() => { selectRef.current?.setCustomValidity(ownerIssue ?? ""); }, [ownerIssue]);
  return (
    <>
      <Field label="Assignee" hint={ownerIssue ?? "Unavailable colleagues show the role or branch that needs updating."}>
        <select
          ref={selectRef}
          aria-invalid={ownerIssue ? true : undefined}
          name="ownerId"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">Unassigned — coordinator to allocate</option>
          {owner && !selectedPerson && <option value={owner} disabled>Previously selected colleague is unavailable</option>}
          {data.people.map((p) => {
            const reason = assignmentUnavailable(p, service, branchId);
            return <option key={p.id} value={p.id} disabled={Boolean(reason)}>{p.name} · {p.roleName}{reason ? ` — ${reason}` : ""}</option>;
          })}
        </select>
      </Field>
      <Field label={owner ? "Due time *" : "Due time"} hint="India time (IST)">
        <input
          type="datetime-local"
          name="dueAt"
          defaultValue={local(dueAt)}
          required={Boolean(owner)}
        />
      </Field>
      {!assignmentOnly && (
        <>
          <label className="flex gap-3 items-center">
            <input
              type="checkbox"
              name="requiresReview"
              checked={review}
              onChange={(e) => setReview(e.target.checked)}
            />
            Require a separate review
          </label>
          <Field label={review ? "Reviewer *" : "Reviewer"}>
            <select
              name="reviewerId"
              required={review}
              defaultValue={reviewerId ?? ""}
            >
              <option value="">Choose reviewer</option>
              {data.people
                .filter(
                  (p) =>
                    p.id !== owner && !assignmentUnavailable(p, service, branchId, true),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}
function CaseFields({
  data,
  initial,
  customerId,
  onSelectionChange,
}: {
  data: WorkData;
  initial?: string;
  customerId?: string;
  onSelectionChange?: (caseId: string, service: string) => void;
}) {
  const [id, setId] = useState(initial ?? "");
  const cases = data.cases.filter(
      (c) => !customerId || c.customerId === customerId,
    ),
    c = cases.find((c) => c.id === id);
  return (
    <>
      <Field label="Case">
        <select
          name="caseId"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            onSelectionChange?.(e.target.value, "");
          }}
        >
          <option value="">Internal work — no customer case</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.caseNo} · {c.title}
            </option>
          ))}
        </select>
        {!customerId && (
          <p className="mt-1 text-xs text-slate-500">
            A customer appears here once they have a trip (a Max ID). {cases.length === 0 ? "None exist yet. " : ""}
            <Link href="/trips/new" className="text-blue-700 underline">Start a trip</Link> for the customer
            {" "}first, or choose Internal work for a general task.
          </p>
        )}
      </Field>
      {id && (
        <Field label="Service work *">
          <select
            key={id}
            name="serviceWorkId"
            required
            onChange={(e) =>
              onSelectionChange?.(
                id,
                c?.serviceWork.find((w) => w.id === e.target.value)?.service ??
                  "",
              )
            }
          >
            <option value="">Choose service</option>
            {c?.serviceWork.map((w) => (
              <option key={w.id} value={w.id}>
                {w.service} · {w.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="work-note">
        Recent 100 permitted open cases. Open an older case directly to add its
        work.
      </p>
    </>
  );
}
function CreateWorkDialog({
  data,
  caseId,
  refreshPeople,
  refreshing,
  close,
  saved,
}: {
  data: WorkData;
  caseId?: string;
  refreshPeople: () => Promise<string | undefined>;
  refreshing: boolean;
  close: () => void;
  saved: () => void;
}) {
  const w = useWorkWrite(),
    [selection, setSelection] = useState({ caseId: caseId ?? "", service: "" });
  const [refreshError, setRefreshError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      requestKey: crypto.randomUUID(),
      caseId: String(f.get("caseId") ?? "") || null,
      serviceWorkId: String(f.get("serviceWorkId") ?? "") || null,
      title: f.get("title"),
      details: f.get("details"),
      ownerId: data.permissions.assign
        ? String(f.get("ownerId") ?? "") || null
        : data.userId,
      dueAt: iso(f.get("dueAt")),
      priority: f.get("priority"),
      requiresReview: f.get("requiresReview") === "on",
      reviewerId: String(f.get("reviewerId") ?? "") || null,
      resultType: f.get("resultType"),
      bookingId: String(f.get("bookingId") ?? "") || null,
      visaCaseId: String(f.get("visaCaseId") ?? "") || null,
      required: true,
      hardDeadline: f.get("hardDeadline") === "on",
    };
    await w.write("/api/work", body, () => {
      saved();
      close();
    });
  }
  return (
    <WorkModal
      busy={w.busy || w.uncertain}
      title="Add to-do"
      onClose={() => {
        if (!w.busy && !w.uncertain) close();
      }}
    >
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={w.busy || w.uncertain} className="space-y-4">
          <CaseFields
            data={data}
            initial={caseId}
            onSelectionChange={(id, service) =>
              setSelection({ caseId: id, service })
            }
          />
          {selection.caseId && selection.service && (
            <WorkSourceChoice
              key={selection.caseId + selection.service}
              caseId={selection.caseId}
              service={selection.service}
            />
          )}
          <Field label="Next action *">
            <input
              name="title"
              required
              minLength={3}
              maxLength={200}
              placeholder="For example: verify the passport documents"
            />
          </Field>
          <Field label="Instructions">
            <textarea name="details" maxLength={3000} rows={3} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue="MEDIUM">
              {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          {data.permissions.assign ? (
            <AssignmentFields
              data={data}
              service={selection.service || undefined}
              branchId={data.cases.find((c) => c.id === selection.caseId)?.branchId ?? data.branchId}
              ownerId={null}
              dueAt={null}
            />
          ) : (
            <Field label="Due time *" hint="India time (IST)">
              <input type="datetime-local" name="dueAt" required />
            </Field>
          )}
          {data.permissions.assign && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <button type="button" className="btn-secondary" disabled={refreshing} onClick={async () => { setRefreshError(""); setRefreshError(await refreshPeople() ?? ""); }}>{refreshing ? "Refreshing staff…" : "Refresh staff list"}</button>
            {data.permissions.configure && <Link href="/employees" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Staff roles & branches <span className="sr-only">(opens in a new tab)</span></Link>}
            {refreshError && <p role="alert" className="text-red-700">{refreshError} Your draft is kept.</p>}
          </div>}
          <Field label="Required result">
            <select name="resultType" defaultValue="NOTE">
              {resultsForService(selection.service)
                .filter((r) => r !== "PAYMENT" || data.permissions.finance)
                .map((r) => (
                  <option key={r} value={r}>
                    {enumLabel(r)}
                  </option>
                ))}
            </select>
          </Field>
          <label className="flex gap-3 items-center">
            <input type="checkbox" name="hardDeadline" />
            Hard service deadline
          </label>
        </fieldset>
        <SaveState error={w.error} uncertain={w.uncertain} />
        <button className="btn-primary" disabled={w.busy}>
          {w.busy
            ? "Saving…"
            : w.uncertain
              ? "Retry same work"
              : "Create work item"}
        </button>
      </form>
    </WorkModal>
  );
}

type Preview = {
  version: number;
  caseId: string;
  service: string;
  steps: {
    key: string;
    title: string;
    instructions: string;
    requiresReview: boolean;
    resultType: string;
    prerequisite: string | null;
    alreadyExists: boolean;
    defaultOwnerId: string | null;
    defaultReviewerId: string | null;
    defaultDueAt: string | null;
    warnings: string[];
  }[];
};
function PlanDialog({
  data,
  selection,
  close,
  saved,
}: {
  data: WorkData;
  selection: { caseId: string; service: string };
  close: () => void;
  saved: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    w = useWorkWrite();
  useEffect(() => {
    const c = new AbortController();
    readJson<Preview>(
      `/api/work/plan?case=${selection.caseId}&service=${selection.service}`,
      c.signal,
    )
      .then(setPreview)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [selection]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await w.write(
      "/api/work/plan",
      {
        requestKey: crypto.randomUUID(),
        caseId: selection.caseId,
        service: selection.service,
        configVersion: preview!.version,
        bookingId: String(f.get("bookingId") ?? "") || null,
        visaCaseId: String(f.get("visaCaseId") ?? "") || null,
        steps: preview!.steps.map((s) => ({
          key: s.key,
          ownerId: String(f.get(`${s.key}-owner`) ?? "") || null,
          reviewerId: String(f.get(`${s.key}-reviewer`) ?? "") || null,
          dueAt: iso(f.get(`${s.key}-due`)),
        })),
      },
      () => {
        saved();
        close();
      },
    );
  }
  return (
    <WorkModal
      busy={w.busy || w.uncertain}
      title={`Plan ${selection.service.toLowerCase()} work`}
      onClose={() => {
        if (!w.busy && !w.uncertain) close();
      }}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!preview && !error && <p role="status">Loading current template…</p>}
      {preview && (
        <form onSubmit={submit} className="space-y-5">
          <p>
            Template version {preview.version}. Existing steps keep their
            assignment, results and deadlines. Adding this service does not book
            or submit anything.
          </p>
          <fieldset disabled={w.busy || w.uncertain} className="space-y-5">
            <WorkSourceChoice
              caseId={selection.caseId}
              service={selection.service}
            />
            {preview.steps.map((s, i) => (
              <section key={s.key} className="work-plan-step">
                <h3>
                  {i + 1}. {s.title}
                </h3>
                <p>{s.instructions}</p>
                {s.warnings.map((text) => (
                  <p className="work-note" key={text}>
                    {text}
                  </p>
                ))}
                {s.prerequisite && (
                  <p>
                    After:{" "}
                    {preview.steps.find((p) => p.key === s.prerequisite)?.title}
                  </p>
                )}
                {s.alreadyExists ? (
                  <p>Already in the case — will be retained.</p>
                ) : (
                  <>
                    <Field label={`${s.title}: assignee`}>
                      <select
                        name={`${s.key}-owner`}
                        defaultValue={s.defaultOwnerId ?? ""}
                      >
                        <option value="">Leave unassigned</option>
                        {data.people
                          .filter(
                            (p) =>
                              p.canWork &&
                              p.services.includes(selection.service),
                          )
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field
                      label={`${s.title}: due time`}
                      hint="Required when assigning a colleague."
                    >
                      <input
                        type="datetime-local"
                        name={`${s.key}-due`}
                        defaultValue={local(s.defaultDueAt)}
                      />
                    </Field>
                    {s.requiresReview && (
                      <Field label={`${s.title}: reviewer *`}>
                        <select
                          required
                          name={`${s.key}-reviewer`}
                          defaultValue={s.defaultReviewerId ?? ""}
                        >
                          <option value="">Choose a separate reviewer</option>
                          {data.people
                            .filter(
                              (p) =>
                                p.canReview &&
                                p.services.includes(selection.service),
                            )
                            .map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                  </>
                )}
              </section>
            ))}
          </fieldset>
          <SaveState error={w.error} uncertain={w.uncertain} />
          <button className="btn-primary" disabled={w.busy}>
            {w.busy
              ? "Applying…"
              : w.uncertain
                ? "Retry same plan"
                : "Apply previewed steps"}
          </button>
        </form>
      )}
    </WorkModal>
  );
}
function BulkDialog({
  data,
  selected: initialSelection,
  close,
  saved,
}: {
  data: WorkData;
  selected: WorkRow[];
  close: () => void;
  saved: () => void;
}) {
  const selected = useRef(initialSelection).current;
  const [results, setResults] = useState<
      { id: string; ok: boolean; error?: string }[] | null
    >(null),
    w = useWorkWrite(),
    keys = useRef(new Map(selected.map((t) => [t.id, crypto.randomUUID()])));
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      body = {
        items: selected.map((t) => ({
          id: t.id,
          version: t.version,
          requestKey: keys.current.get(t.id),
        })),
        ownerId: String(f.get("ownerId") ?? "") || null,
        dueAt: iso(f.get("dueAt")),
        note: String(f.get("note") ?? ""),
      };
    await w.write("/api/work/bulk", body, (value) => {
      setResults(
        (value as { results: { id: string; ok: boolean; error?: string }[] })
          .results,
      );
      saved();
    });
  }
  return (
    <WorkModal
      busy={w.busy || w.uncertain}
      title={`Assign ${selected.length} work items`}
      onClose={() => {
        if (!w.busy && !w.uncertain) close();
      }}
    >
      {results ? (
        <>
          <p>
            {results.filter((r) => r.ok).length} assigned;{" "}
            {results.filter((r) => !r.ok).length} unchanged.
          </p>
          <ul>
            {results
              .filter((r) => !r.ok)
              .map((r) => (
                <li key={r.id}>
                  {selected.find((t) => t.id === r.id)?.title}: {r.error}
                </li>
              ))}
          </ul>
          <button className="btn-secondary" onClick={close}>
            Close
          </button>
        </>
      ) : (
        <form className="space-y-5" onSubmit={submit}>
          <p>
            Preview: {selected.map((t) => t.title).join("; ")}. Each item is
            validated separately. Ineligible or changed items remain unchanged.
          </p>
          <fieldset disabled={w.busy || w.uncertain} className="space-y-4">
            <AssignmentFields
              assignmentOnly
              data={data}
              ownerId={null}
              dueAt={null}
            />
            <Field label="Assignment / deadline reason *">
              <textarea name="note" required minLength={3} maxLength={1000} />
            </Field>
          </fieldset>
          <SaveState error={w.error} uncertain={w.uncertain} />
          <button className="btn-primary" disabled={w.busy}>
            {w.uncertain ? "Retry same assignments" : "Apply assignments"}
          </button>
        </form>
      )}
    </WorkModal>
  );
}

function WorkModal({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
}) {
  const id = useId();
  return (
    <Modal labelledBy={id} onClose={onClose} busy={busy} width="max-w-3xl">
      <div className="work-dialog">
        <div className="work-dialog-header">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close work dialog"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </Modal>
  );
}
