"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon, { type IconName } from "@/components/Icon";
import { Field } from "@/components/ui";

type Customer = { id: string; name: string; code: string };
export type NeedId = "ENQUIRY" | "FLIGHT" | "HOTEL" | "VISA" | "OTHER";
const NEEDS: Record<NeedId, { label: string; hint: string; icon: IconName; service: string; next: (id: string) => string }> = {
  ENQUIRY: { label: "Enquiry / quote", hint: "Not sure yet, send options first", icon: "compass", service: "FLIGHT", next: id => `/sales?action=new&case=${id}` },
  FLIGHT: { label: "Flight", hint: "Book or record a ticket", icon: "plane", service: "FLIGHT", next: id => `/ticketing/new?case=${id}&product=FLIGHT` },
  HOTEL: { label: "Hotel", hint: "Book or record a stay", icon: "board", service: "HOTEL", next: id => `/ticketing/new?case=${id}&product=HOTEL` },
  VISA: { label: "Visa", hint: "Start a visa application", icon: "visa", service: "VISA", next: id => `/visa/new?case=${id}` },
  OTHER: { label: "Other", hint: "Bus, train, insurance", icon: "list", service: "BUS", next: id => `/ticketing/new?case=${id}&product=BUS` },
};

export default function NewTrip({ needs, initial, canAddCustomer }: { needs: NeedId[]; initial: Customer | null; canAddCustomer: boolean }) {
  const router = useRouter(), tripKey = useRef(""), customerKey = useRef("");
  const [customer, setCustomer] = useState<Customer | null>(initial);
  const [query, setQuery] = useState(""), [results, setResults] = useState<Customer[]>([]), [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false), [form, setForm] = useState({ name: "", phone: "", email: "", city: "" });
  const [duplicate, setDuplicate] = useState<Customer | null>(null), allowDuplicate = useRef(false);
  const [need, setNeed] = useState<NeedId | null>(null), [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    if (customer || adding) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/cases?q=${encodeURIComponent(query.trim())}`, { signal: c.signal })
        .then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); setResults(d.customers); })
        .catch(e => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Customer search failed."); })
        .finally(() => { if (!c.signal.aborted) setSearching(false); });
    }, 250);
    return () => { clearTimeout(t); c.abort(); };
  }, [query, customer, adding]);

  async function addCustomer(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    if (!customerKey.current) customerKey.current = crypto.randomUUID();
    setBusy(true); setError(""); setDuplicate(null);
    try {
      const r = await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: customerKey.current, type: "INDIVIDUAL", createPrimaryTraveller: true, ...form, ...(allowDuplicate.current ? { allowDuplicate: true } : {}) }) });
      const d = await r.json();
      if (r.status === 409 && d.code === "DUPLICATE_PHONE") { setDuplicate(d.existing); setError(d.error); customerKey.current = ""; return; }
      if (!r.ok) throw Error(d.error ?? "Could not add the customer.");
      setCustomer({ id: d.id, name: form.name.trim(), code: d.code }); setAdding(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add the customer."); }
    finally { setBusy(false); allowDuplicate.current = false; }
  }

  async function start() {
    if (!customer || !need || busy) return;
    if (!tripKey.current) tripKey.current = crypto.randomUUID();
    setBusy(true); setError("");
    const n = NEEDS[need], name = title.trim().length >= 3 ? title.trim() : `${n.label} – ${customer.name}`;
    try {
      const r = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: tripKey.current, customerId: customer.id, service: n.service, title: name.slice(0, 200) }) });
      const d = await r.json();
      if (!r.ok) { if (r.status < 500) tripKey.current = ""; throw Error(d.error ?? "Could not start the trip."); }
      router.push(n.next(d.caseId));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the trip. Check your connection and press Start trip again."); setBusy(false); }
  }

  return <div className="space-y-5">
    <section className="panel space-y-4 p-5" aria-labelledby="who">
      <h2 id="who" className="text-lg font-semibold">1. Who is it for?</h2>
      {customer ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-teal-50 p-3">
        <p><strong>{customer.name}</strong> <span className="text-sm text-slate-600">· {customer.code}</span></p>
        <button type="button" className="btn-secondary" onClick={() => { setCustomer(null); setNeed(null); tripKey.current = ""; }}>Change</button>
      </div> : adding ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={addCustomer}>
        <Field label="Full name"><input required maxLength={150} autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Mobile number"><input required type="tel" maxLength={40} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email (optional)"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="City (optional)"><input maxLength={150} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></Field>
        {duplicate && <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => { setCustomer(duplicate); setAdding(false); setDuplicate(null); setError(""); }}>Use {duplicate.name}</button>
          <button type="submit" className="btn-secondary" onClick={() => { allowDuplicate.current = true; }}>Add anyway (different person)</button>
        </div>}
        <div className="sm:col-span-2 flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Add customer"}</button><button type="button" className="btn-secondary" onClick={() => { setAdding(false); setDuplicate(null); setError(""); }}>Back to search</button></div>
        <p className="sm:col-span-2 text-xs text-slate-500">You can fill in passport and other traveller details later on the customer page.</p>
      </form> : <div className="space-y-3">
        <input type="search" autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone or customer code" aria-label="Search customers" className="w-full" />
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-live="polite">
          {results.map(c => <li key={c.id}><button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => { setCustomer(c); setError(""); }}><span><strong className="text-sm">{c.name}</strong> <span className="text-xs text-slate-500">· {c.code}</span></span><Icon name="arrow" size={14} /></button></li>)}
          {!results.length && <li className="px-3 py-2.5 text-sm text-slate-500">{searching ? "Searching…" : query ? "No customer found." : "No customers yet."}</li>}
        </ul>
        {canAddCustomer && <button type="button" className="btn-secondary" onClick={() => { setAdding(true); setError(""); setForm(f => ({ ...f, name: /\d/.test(query) ? f.name : query, phone: /\d/.test(query) ? query : f.phone })); }}><Icon name="plus" size={16} />New customer</button>}
      </div>}
    </section>

    <section className={`panel space-y-4 p-5 ${customer ? "" : "opacity-60"}`} aria-labelledby="what">
      <h2 id="what" className="text-lg font-semibold">2. What do they need?</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-labelledby="what">
        {needs.map(id => { const n = NEEDS[id]; return <button key={id} type="button" role="radio" aria-checked={need === id} disabled={!customer} onClick={() => setNeed(id)} className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left ${need === id ? "border-teal-700 bg-teal-50 ring-2 ring-teal-700" : "border-slate-200 hover:border-teal-600"}`}><Icon name={n.icon} size={20} className="text-teal-700" /><strong className="text-sm">{n.label}</strong><span className="text-xs text-slate-500">{n.hint}</span></button>; })}
      </div>
      {customer && need && <Field label="Trip name (optional)" hint={`If left empty: ${NEEDS[need].label} – ${customer.name}`}><input maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Dubai family holiday, Dec" /></Field>}
      <p className="text-sm text-slate-600">You can add more services (hotel, visa, insurance…) to the same trip afterwards.</p>
    </section>

    {error && <div role="alert" className="form-error">{error}{duplicate && <> <Link className="underline" href={`/masters/${duplicate.id}`}>Open {duplicate.name}</Link></>}</div>}
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={!customer || !need || busy} onClick={start}>{busy && customer && need ? "Starting…" : "Start trip"}</button><Link className="btn-secondary" href="/trips">Cancel</Link></div>
  </div>;
}
