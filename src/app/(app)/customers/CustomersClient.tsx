"use client";
import { enumLabel } from "@/lib/labels";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";
import { PageHeader, EmptyState, Field, StatCard, Status, ViewToggle, avatarClass, initialsOf } from "@/components/ui";
import { BoardCard, BoardColumn } from "@/components/Board";
import Modal from "@/components/Modal";

interface C {
  id: string; code: string; name: string; type: string; phone: string; email: string | null; city: string;
  status: string; branch: string; manager: string | null; companyName: string | null; createdLabel: string;
}
type Tone = "neutral" | "success" | "warning" | "danger" | "info";

// Board columns follow the customer lifecycle stored on each record: lead -> active -> inactive.
const COLUMNS = [
  { status: "LEAD", title: "Leads", dot: "bg-sky-500", tone: "info" as Tone },
  { status: "ACTIVE", title: "Active", dot: "bg-emerald-500", tone: "success" as Tone },
  { status: "INACTIVE", title: "Inactive", dot: "bg-slate-400", tone: "neutral" as Tone },
];
const toneFor = (status: string): Tone => COLUMNS.find(c => c.status === status)?.tone ?? "neutral";

// Cards and rows render in pages so a list of 1,000+ customers stays fast and the board stays scannable.
const PAGE = 40;

export default function CustomersClient({ customers, canCreate, canExport }: { customers: C[]; canCreate: boolean; canExport: boolean }) {
  const sp = useSearchParams();
  const [view, setView] = useState<"board" | "list">("list");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [show, setShow] = useState(canCreate && sp.get("action") === "new");
  const [shown, setShown] = useState<Record<string, number>>({});
  const [listShown, setListShown] = useState(PAGE);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter(c =>
      (type === "ALL" || c.type === type) &&
      (!q || [c.name, c.phone, c.code, c.city, c.email ?? "", c.companyName ?? ""].some(v => v.toLowerCase().includes(q))));
  }, [customers, query, type]);

  // A new search or filter starts every column and the list back at the first page.
  function resetPaging() { setShown({}); setListShown(PAGE); }

  function renderCard(c: C) {
    return <BoardCard key={c.id}>
      <div className="flex items-start gap-3">
        <span className={`avatar ${avatarClass(c.name)}`} aria-hidden="true">{initialsOf(c.name)}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/customers/${c.id}`} className="board-card-title">{c.name}</Link>
          <div className="text-small text-slate-500">{c.code} · Joined {c.createdLabel}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Status tone={toneFor(c.status)}>{enumLabel(c.status)}</Status>
        <Status>{enumLabel(c.type)}</Status>
      </div>
      <div className="mt-3 text-xs text-slate-600"><a className="hover:underline" href={`tel:${c.phone}`}>{c.phone}</a>{c.city && <span className="block mt-1 text-slate-500">{c.city}</span>}</div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-small text-slate-500">
        <span>Manager: {c.manager ?? "Unassigned"}</span>
        {c.companyName && <span className="shrink-0 font-medium text-slate-600">{c.companyName}</span>}
      </div>
      <Link href={`/customers/${c.id}`} className="board-open-link">Open customer<Icon name="arrow" size={14}/></Link>
    </BoardCard>;
  }

  return <div className="workspace-page">
    <PageHeader title="Customers" description="Each customer's travellers, bookings, visa cases and balances in one place."
      actions={<>{canExport && <a className="btn-secondary" href="/api/export?entity=customers"><Icon name="download" size={16} />Export</a>}{canCreate && <button className="btn-primary" onClick={() => setShow(true)}><Icon name="plus" size={17} />New customer</button>}</>} />
    <div className="summary-strip" aria-label="Customer directory summary">
      <StatCard label="Customers" value={customers.length} icon="customers" note="Visible in your workspace" />
      <StatCard label="Active relationships" value={customers.filter(c => c.status === "ACTIVE").length} icon="check" />
      <StatCard label="Corporate & partner" value={customers.filter(c => c.type !== "INDIVIDUAL").length} icon="suppliers" />
    </div>

    <div className="workspace-toolbar">
      <ViewToggle label="Customer view" value={view} onChange={setView} options={[{ value: "board", label: "Board", icon: "board" }, { value: "list", label: "List", icon: "list" }]} />
      <select aria-label="Customer type" className="control max-w-[220px]" value={type} onChange={e => { setType(e.target.value); resetPaging(); }}>
        <option value="ALL">All customer types</option>
        <option value="INDIVIDUAL">Individual</option>
        <option value="CORPORATE">Corporate</option>
        <option value="SUB_AGENT">Sub-agent</option>
      </select>
      <div className="relative min-w-[220px] flex-1 md:max-w-sm">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={16} /></span>
        <input type="search" aria-label="Filter customers" className="control w-full pl-9" placeholder="Name, phone, email or city…" value={query} onChange={e => { setQuery(e.target.value); resetPaging(); }} />
      </div>
    </div>
    <p className="mb-3 text-xs text-slate-600">Showing {visible.length} of {customers.length} customers · {view === "board" ? "grouped by relationship status" : "sorted by name"}</p>

    {!visible.length && <EmptyState icon="customers" title={customers.length ? "No matching customers" : "No customers yet"}
      description={customers.length ? "Try another name, phone number or customer type." : "Add your first real customer. We’ll create their primary traveller and keep cases, bookings, documents and money together."}
      action={!customers.length && canCreate ? "Add your first customer" : undefined} onAction={() => setShow(true)} />}

    {view === "board" && visible.length > 0 && <div className="board-guide"><div><strong>Customer relationships</strong><p>Leads are potential customers, Active customers have an ongoing relationship, and Inactive customers are no longer active. Open a customer to manage their work.</p></div></div>}
    {view === "board" && visible.length > 0 && <div className="board-scroll board-scroll--three workflow-board relationship-board" aria-label="Customers by status">
      {COLUMNS.map(col => {
        const cards = visible.filter(c => c.status === col.status);
        const limit = shown[col.status] ?? PAGE;
        const remaining = cards.length - limit;
        return <BoardColumn key={col.status} title={col.title} description={col.status === "LEAD" ? "Follow up and understand travel needs" : col.status === "ACTIVE" ? "Manage current and repeat customers" : "Past relationships kept for reference"} dot={col.dot} count={cards.length} countLabel={`${cards.length} customers`} empty={cards.length === 0}>
          {cards.slice(0, limit).map(renderCard)}
          {cards.length === 0 && <p className="board-empty">No matching customers in this group.</p>}
          {remaining > 0 && <button type="button" className="btn-secondary w-full" onClick={() => setShown({ ...shown, [col.status]: limit + PAGE })}>Show {Math.min(PAGE, remaining)} more · {remaining} left</button>}
        </BoardColumn>;
      })}
    </div>}

    {view === "list" && visible.length > 0 && <div className="panel overflow-x-auto">
      <table className="text-sm">
        <thead><tr>{["Customer", "Contact", "City", "Type", "Relationship manager", "Status"].map(t => <th key={t} className="px-5">{t}</th>)}</tr></thead>
        <tbody>{visible.slice(0, listShown).map(c => <tr key={c.id} className="border-t">
          <td className="px-5"><Link href={`/customers/${c.id}`} className="flex items-center gap-3">
            <span className={`avatar ${avatarClass(c.name)}`} aria-hidden="true">{initialsOf(c.name)}</span>
            <span><span className="block font-semibold hover:text-teal-700">{c.name}</span><span className="text-small text-slate-500">{c.code}</span></span>
          </Link></td>
          <td className="px-5"><span className="block text-xs">{c.phone}</span><span className="text-small text-slate-500">{c.email ?? ""}</span></td>
          <td className="px-5 text-xs text-slate-500">{c.city || "—"}</td>
          <td className="px-5 text-xs text-slate-500">{enumLabel(c.type)}</td>
          <td className="px-5 text-xs text-slate-500">{c.manager ?? "Unassigned"}</td>
          <td className="px-5"><Status tone={toneFor(c.status)}>{enumLabel(c.status)}</Status></td>
        </tr>)}</tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-slate-500">
        <span>Showing {Math.min(listShown, visible.length)} of {visible.length} matching · {customers.length} total</span>
        {visible.length > listShown && <button type="button" className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setListShown(listShown + PAGE)}>Show {Math.min(PAGE, visible.length - listShown)} more</button>}
      </div>
    </div>}

    {show && <NewCustomer onClose={() => setShow(false)} />}
  </div>;
}

function NewCustomer({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", city: "", type: "INDIVIDUAL" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "Could not create customer."); return; }
      location.assign(`/customers/${d.id}`);
    } catch { setError("Connection failed. Your details are still here—please try again."); }
    finally { setBusy(false); }
  }
  return <Modal labelledBy="new-customer-title" onClose={onClose} width="max-w-lg" busy={busy}>
    <form onSubmit={submit} className="space-y-4">
      <div className="flex justify-between"><div><h2 id="new-customer-title" className="text-xl font-semibold">Add a customer</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      <p className="text-xs leading-5 text-slate-500">Just the essentials. You can add family members, passport details and preferences in their workspace.</p>
      <Field label="Full name *"><input autoFocus autoComplete="name" required maxLength={150} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label="Phone *"><input type="tel" required maxLength={40} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="City"><input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></Field>
        <Field label="Customer type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="INDIVIDUAL">Individual</option><option value="CORPORATE">Corporate</option><option value="SUB_AGENT">Sub-agent</option></select></Field>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create customer"}<Icon name="arrow" size={16} /></button></div>
    </form>
  </Modal>;
}
