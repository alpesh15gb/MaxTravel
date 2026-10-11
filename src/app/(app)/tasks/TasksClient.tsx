"use client";
import { enumLabel } from "@/lib/labels";
import { dateTimeLabel } from "@/lib/dates";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { PageHeader, EmptyState, Field, Status, ViewToggle } from "@/components/ui";
import RecordEditor from "@/components/RecordEditor";
import ActionDialog from "@/components/ActionDialog";
import Modal from "@/components/Modal";

type T = { id: string; title: string; status: string; priority: string; details?: string | null; owner: string; mine: boolean; dueAt: string | null; customer: { name: string; id: string } | null; visaCase: { caseNo: string; id: string } | null; booking: { bookingNo: string; id: string } | null };
type Tab = "OPEN" | "MINE" | "OVERDUE" | "DONE";
type Group = { label: string; tone: "overdue" | "normal"; items: T[] };

const isOpen = (t: T) => ["OPEN", "IN_PROGRESS"].includes(t.status);

// Queue groups in the order a person works through them. Anything without a date sits last.
function groupsFor(list: T[], tab: Tab): Group[] {
  if (tab === "DONE") return list.length ? [{ label: "Closed", tone: "normal", items: list }] : [];
  const now = new Date();
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const buckets: Record<string, T[]> = { Overdue: [], Today: [], "This week": [], Later: [], "No due date": [] };
  for (const t of list) {
    if (!t.dueAt) buckets["No due date"].push(t);
    else {
      const d = new Date(t.dueAt);
      if (d < now) buckets.Overdue.push(t);
      else if (d <= endToday) buckets.Today.push(t);
      else if (d <= endWeek) buckets["This week"].push(t);
      else buckets.Later.push(t);
    }
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length)
    .map(([label, items]) => ({ label, tone: label === "Overdue" ? "overdue" as const : "normal" as const, items }));
}

export default function TasksClient({ tasks, focus, canEdit, canExport, canCreate, owners, customers, currentUserId }: { tasks: T[]; focus: string | null; canEdit: boolean; canExport?: boolean; canCreate: boolean; owners: { id: string; name: string }[]; customers: { id: string; name: string }[]; currentUserId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("OPEN");
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [cancelTarget, setCancelTarget] = useState<T | null>(null);
  const overdue = (t: T) => isOpen(t) && !!t.dueAt && new Date(t.dueAt) < new Date();
  const filtered = tasks.filter(t => tab === "DONE" ? !isOpen(t) : tab === "MINE" ? isOpen(t) && t.mine : tab === "OVERDUE" ? overdue(t) : isOpen(t));
  const groups = useMemo(() => groupsFor(filtered, tab), [filtered, tab]);

  async function status(id: string, next: string) {
    setBusy(id);
    try {
      const r = await fetch("/api/tasks/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: id, status: next }) });
      const d = await r.json().catch(() => ({}));
      setNotice(r.ok ? "Task updated." : d.error ?? "Could not update.");
      if (r.ok) router.refresh();
    } catch { setNotice("Connection failed. Please try again."); }
    finally { setBusy(""); }
  }

  function renderRow(t: T) {
    const late = overdue(t);
    return <li key={t.id} className={`grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_160px_200px] md:items-center md:px-5 ${focus === t.id ? "bg-teal-50/60" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${late ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"}`}><Icon name={isOpen(t) ? "tasks" : "check"} size={15} /></span>
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-900">{t.title}</h3>
        </div>
        <p className="mt-1 pl-9 text-xs text-slate-500">{t.owner}{t.mine ? " · You" : ""}</p>
        {t.details && <p className="mt-1 line-clamp-2 pl-9 text-xs leading-5 text-slate-600">{t.details}</p>}
        <div className="mt-1 flex flex-wrap gap-3 pl-9 text-xs text-teal-700">
          {t.customer && <Link href={`/customers/${t.customer.id}`}>{t.customer.name}</Link>}
          {t.visaCase && <Link href={`/visa/${t.visaCase.id}`}>{t.visaCase.caseNo}</Link>}
          {t.booking && <Link href={`/ticketing/${t.booking.id}`}>{t.booking.bookingNo}</Link>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-9 md:pl-0">
        <span className={`text-xs ${late ? "font-semibold text-amber-700" : "text-slate-600"}`}>{t.dueAt ? `${late ? "Overdue · " : ""}${dateTimeLabel(t.dueAt)}` : "No due date"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-9 md:justify-end md:pl-0">
        <Status tone={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "warning" : "neutral"}>{enumLabel(t.priority)}</Status>
        <Status tone={t.status === "DONE" ? "success" : "info"}>{enumLabel(t.status)}</Status>
        {canEdit && isOpen(t) && <RecordEditor title="Edit task" buttonLabel="Edit" endpoint={`/api/tasks/${t.id}`} values={{ title: t.title, details: t.details ?? "", priority: t.priority, ownerId: owners.find(o => o.name === t.owner)?.id ?? currentUserId, dueAt: t.dueAt ? new Date(new Date(t.dueAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "" }} fields={[{ key: "title", label: "Task", required: true }, { key: "ownerId", label: "Owner", type: "select", options: owners.map(o => ({ value: o.id, label: o.name })) }, { key: "priority", label: "Priority", type: "select", options: ["LOW", "MEDIUM", "HIGH", "URGENT"].map(v => ({ value: v, label: v })) }, { key: "dueAt", label: "Due date & time", type: "datetime-local" }, { key: "details", label: "Details", type: "textarea" }]} />}
        {canEdit && isOpen(t) && <button disabled={!!busy} className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setCancelTarget(t)}>Cancel task</button>}
        {canEdit && <button disabled={!!busy} className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => status(t.id, isOpen(t) ? "DONE" : "OPEN")}>{busy === t.id ? "Saving…" : isOpen(t) ? "Mark done" : "Reopen"}</button>}
      </div>
    </li>;
  }

  const openCount = tasks.filter(isOpen).length;
  const mineCount = tasks.filter(t => isOpen(t) && t.mine).length;
  const overdueCount = tasks.filter(overdue).length;

  return <div className="workspace-page">
    <PageHeader title="Tasks & follow-ups" description="The next action, its owner, priority and due date." actions={<>{canExport && <a className="btn-secondary" href="/api/export?entity=tasks">Export</a>}{canCreate && <button className="btn-primary" onClick={() => setShow(true)}><Icon name="plus" size={16} />New task</button>}</>} />

    <div className="summary-strip">
      <div className="px-3 py-2.5"><div className="text-small font-medium text-slate-500">Open</div><div className="mt-1 text-2xl font-semibold tabular-nums">{openCount}</div></div>
      <div className="px-3 py-2.5"><div className="text-small font-medium text-slate-500">Assigned to you</div><div className="mt-1 text-2xl font-semibold tabular-nums">{mineCount}</div></div>
      <div className={`px-3 py-2.5 ${overdueCount ? "border-amber-200 bg-amber-50/50" : ""}`}><div className="text-small font-medium text-slate-500">Overdue</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${overdueCount ? "text-amber-700" : ""}`}>{overdueCount}</div></div>
    </div>

    <div className="workspace-toolbar justify-between">
      <ViewToggle label="Task view" value={tab} onChange={setTab} options={[{ value: "OPEN", label: "Open" }, { value: "MINE", label: "Mine" }, { value: "OVERDUE", label: "Overdue" }, { value: "DONE", label: "Done" }]} />
      <p className="text-xs text-slate-500">{filtered.length} shown · up to 200 recent tasks in your scope</p>
    </div>
    {notice && <div className="form-success mb-4" role="status">{notice}</div>}

    {!filtered.length
      ? <EmptyState icon="tasks" title={tasks.length ? "Nothing in this view" : "No tasks yet"} description={tasks.length ? "Switch views to see your other follow-ups." : "Create your first task to keep appointments, customer callbacks and team handoffs on track."} action={canCreate ? "Create a task" : undefined} onAction={() => setShow(true)} />
      : <div className="space-y-6">
        {groups.map(g => <section key={g.label} aria-label={g.label}>
          <div className="mb-2 flex items-center gap-2 px-1">
            <h2 className={`text-micro font-semibold uppercase tracking-[.14em] ${g.tone === "overdue" ? "text-amber-700" : "text-slate-600"}`}>{g.label}</h2>
            <span className="text-small tabular-nums text-slate-600">{g.items.length}</span>
          </div>
          <ul className="panel divide-y divide-slate-100 overflow-hidden">{g.items.map(renderRow)}</ul>
        </section>)}
      </div>}

    {show && <TaskForm owners={owners} customers={customers} currentUserId={currentUserId} onClose={() => setShow(false)} onSaved={() => { setShow(false); setNotice("Task created."); router.refresh(); }} />}

    {cancelTarget && <ActionDialog
      title={`Cancel “${cancelTarget.title}”?`}
      description="The task is closed for work but stays visible on the record, so the trail stays intact. You can reopen it at any time from the Done view."
      tone="danger"
      confirmLabel="Cancel task"
      busy={!!busy}
      onClose={() => setCancelTarget(null)}
      onConfirm={() => { const id = cancelTarget.id; setCancelTarget(null); void status(id, "CANCELLED"); }}
    />}
  </div>;
}

function TaskForm({ owners, customers, currentUserId, onClose, onSaved }: { owners: { id: string; name: string }[]; customers: { id: string; name: string }[]; currentUserId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", details: "", ownerId: currentUserId, customerId: "", priority: "MEDIUM", dueAt: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "Could not create task."); return; }
      onSaved();
    } catch { setError("Connection failed. Your form is preserved."); }
    finally { setBusy(false); }
  }
  return <Modal label="New task" onClose={onClose} width="max-w-lg" busy={busy}>
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="text-xl font-semibold">A clear next step</h2>
      <Field label="Task *"><input autoFocus required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="What needs to happen?" /></Field>
      <div className="form-grid">
        <Field label="Owner"><select value={form.ownerId} onChange={e => setForm({ ...form, ownerId: e.target.value })}>{owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Priority"><select aria-label="Priority" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map(p => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Due date & time"><input type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} /></Field>
        <Field label="Customer (optional)"><select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })}><option value="">Internal task</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <Field label="Details"><textarea rows={3} value={form.details} onChange={e => setForm({ ...form, details: e.target.value })} /></Field>
      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create task"}</button></div>
    </form>
  </Modal>;
}
