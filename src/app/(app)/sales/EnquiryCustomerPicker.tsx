"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { useCustomerCreateEntry, useCustomerCreateMemory } from "@/components/SalesDraftProvider";
import { customerPrerequisite, type SalesCustomer } from "./sales-workspace";
import { createEnquiryCustomer, CustomerAccessChanged, mergeCustomers, readEnquiryCustomers, type CustomerFields } from "./enquiry-customer";

const emptyCustomer = (): CustomerFields => ({ name: "", phone: "", email: "", city: "", type: "INDIVIDUAL" });

/** In-flow only: no PII in storage, URLs or a cross-route draft. The enquiry form never unmounts. */
export default function EnquiryCustomerPicker({ context, initialCustomers, disabled, onDirty, onAccessChanged }: {
  context: string; initialCustomers: SalesCustomer[]; disabled: boolean;
  onDirty: () => void; onAccessChanged: () => void;
}) {
  const createMemory = useCustomerCreateMemory();
  const customerWrite = useCustomerCreateEntry();
  const [customers, setCustomers] = useState(initialCustomers);
  const [selected, setSelected] = useState<SalesCustomer | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [fields, setFields] = useState(emptyCustomer);
  const [customerDirty, setCustomerDirty] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const saving = verifying || customerWrite?.phase === "submitting";
  const [saveError, setSaveError] = useState("");
  const saveState = customerWrite?.phase === "submitting" ? "editing" : customerWrite?.phase ?? "editing";
  const createdId = customerWrite?.customerId ?? null;
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const activation = useRef(0);
  const readGeneration = useRef(0);
  const saveLock = useRef(false);
  const section = useRef<HTMLElement>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  const close = () => {
    if (saveLock.current || (customerDirty && saveState === "editing" && !window.confirm("Discard the unsaved customer details? Your enquiry fields will stay here."))) return;
    setShowCreate(false); setCustomerDirty(false); setFields(emptyCustomer()); setSaveError("");
  };

  useEffect(() => {
    mounted.current = true; activation.current += 1; setVerifying(false);
    saveLock.current = createMemory.getSnapshot()?.phase === "submitting";
    return () => { mounted.current = false; activation.current += 1; readGeneration.current += 1; };
  }, [createMemory]);
  useEffect(() => { if (saveError) error.current?.focus(); }, [saveError]);
  useEffect(() => { if (notice && !showCreate) picker.current?.focus(); }, [notice, showCreate]);
  useEffect(() => {
    // The owner decides whether to close. A declined dirty-close prompt must also prevent
    // the native dialog's default Escape close (cancel does not bubble, so capture it).
    const scope = section.current;
    const preventNativeClose = (event: Event) => event.preventDefault();
    scope?.addEventListener("cancel", preventNativeClose, true);
    return () => scope?.removeEventListener("cancel", preventNativeClose, true);
  }, []);

  async function searchCustomers(append = false) {
    if (disabled || saveLock.current) return;
    const generation = ++readGeneration.current;
    setReading(true); setReadError("");
    const activeQuery = append ? appliedQuery : query.trim();
    const params = new URLSearchParams({ customers: "1", q: activeQuery });
    if (append && nextCursor) params.set("cursor", nextCursor);
    try {
      const result = await readEnquiryCustomers(params, context);
      if (!mounted.current || generation !== readGeneration.current) return;
      setCustomers(previous => append ? mergeCustomers(previous, result.customers) : result.customers);
      setNextCursor(result.nextCursor); setAppliedQuery(activeQuery);
      const entry = createMemory.getSnapshot();
      if (entry?.phase === "uncertain") createMemory.markReviewed(entry.nonce);
    } catch (caught) {
      if (!mounted.current || generation !== readGeneration.current) return;
      if (caught instanceof CustomerAccessChanged) onAccessChanged();
      else setReadError(caught instanceof Error ? caught.message : "Customer search failed. Try searching again.");
    } finally { if (mounted.current && generation === readGeneration.current) setReading(false); }
  }

  async function verifyCreatedCustomer(id: string, nonce: string, generation: number) {
    setVerifying(true);
    const result = await readEnquiryCustomers(new URLSearchParams({ customerId: id }), context);
    if (!mounted.current || activation.current !== generation || createMemory.getSnapshot()?.nonce !== nonce) return;
    const customer = result.customers[0];
    setCustomers(previous => mergeCustomers(previous, [customer])); setSelected(customer);
    setShowCreate(false); setFields(emptyCustomer()); setCustomerDirty(false); createMemory.clear(nonce);
    setNotice("Customer created and selected. Your enquiry fields are unchanged; save the enquiry when ready.");
    onDirty();
  }

  async function submitCustomer(event: React.FormEvent) {
    event.preventDefault();
    if (saveLock.current || disabled || saveState !== "editing") return;
    const nonce = crypto.randomUUID();
    if (createMemory.context !== context) { onAccessChanged(); return; }
    if (!createMemory.begin(nonce)) return;
    const generation = activation.current;
    saveLock.current = true; setSaveError(""); setNotice("");
    try {
      const result = await createEnquiryCustomer(fields, context);
      // Settle even when Activity has hidden/unmounted this picker. No hidden UI callback owns the barrier.
      createMemory.settle(nonce, result);
      if (!mounted.current || activation.current !== generation) return;
      if (result.kind === "access-changed") { onAccessChanged(); return; }
      if (result.kind === "rejected") { setSaveError(result.message); return; }
      if (result.kind === "uncertain") {
        setSaveError("The customer save outcome is unknown. It may have completed. Do not create it again. Return to the enquiry and search the customer list to check."); return;
      }
      await verifyCreatedCustomer(result.id, nonce, generation);
    } catch (caught) {
      if (!mounted.current || activation.current !== generation) return;
      if (caught instanceof CustomerAccessChanged) onAccessChanged();
      else setSaveError("The customer was created, but its current access could not be verified. Do not create it again. Check the saved customer to continue.");
    } finally { saveLock.current = false; if (mounted.current && activation.current === generation) setVerifying(false); }
  }

  async function checkSavedCustomer() {
    if (!createdId || !customerWrite || saveLock.current || disabled) return;
    const generation = activation.current;
    saveLock.current = true; setVerifying(true); setSaveError("");
    try { await verifyCreatedCustomer(createdId, customerWrite.nonce, generation); }
    catch (caught) {
      if (!mounted.current || activation.current !== generation) return;
      if (caught instanceof CustomerAccessChanged) onAccessChanged();
      else setSaveError("The saved customer is not available yet. Check again or ask an administrator to review its access. Do not create it again.");
    } finally { saveLock.current = false; if (mounted.current && activation.current === generation) setVerifying(false); }
  }

  const choices = selected ? mergeCustomers([selected], customers) : customers;
  const change = (key: keyof CustomerFields, value: string) => { setFields(previous => ({ ...previous, [key]: value })); setCustomerDirty(true); onDirty(); };
  return <section ref={section} className="mb-5 space-y-3" aria-label="Enquiry customer">
    {!initialCustomers.length && !selected && <section className="rounded-xl border p-3 space-y-2" aria-label="Customer needed before enquiry">
      <h3 className="font-semibold">Add or find a customer first</h3>
      <p className="text-sm">Your enquiry fields stay here while you add a customer.</p>
      <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">Customer access &amp; unsaved fields</summary><p>{customerPrerequisite(true).explanation} Keep this page open: reloading or leaving clears unsaved enquiry fields.</p></details>
    </section>}
    <div className="flex flex-wrap items-end gap-2">
      <div className="field min-w-0 flex-1 text-sm font-medium"><label className="field-label" htmlFor="sales-customer-search">Find a customer</label><input ref={search} id="sales-customer-search" className="control mt-1" type="search" maxLength={100} placeholder="Name or customer code" value={query} disabled={disabled || saving} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchCustomers(); } }} /></div>
      <button type="button" className="btn" disabled={disabled || reading || saving} onClick={() => void searchCustomers()}>Search customers</button>
      <button type="button" className="btn" disabled={disabled || saving || saveState !== "editing"} onClick={() => { setShowCreate(true); setSaveError(""); }}>{customerPrerequisite(true).action}</button>
    </div>
    <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-customer">Customer</label><select ref={picker} id="sales-customer" form="sales-new-enquiry" className="control mt-1" name="customer" required disabled={disabled || saving} value={selected?.id ?? ""} onChange={event => { setSelected(choices.find(customer => customer.id === event.target.value) ?? null); onDirty(); }}><option value="" disabled>Select a customer</option>{choices.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></div>
    <p className="text-sm text-slate-600">{reading ? "Checking permitted customers…" : `Showing ${customers.length} customer matches${appliedQuery ? ` for “${appliedQuery}”` : ""}. Search by name or code for another customer.`}{selected && " Your selected customer stays selected when you search."}</p>
    {nextCursor && <button type="button" className="btn" disabled={disabled || reading || saving} onClick={() => void searchCustomers(true)}>Load more customers</button>}
    {!choices.length && !reading && <p className="text-sm">No customers in this list. Search your permitted customers or add one here.</p>}
    {readError && <p role="alert" className="form-error">{readError}</p>}
    {notice && <p role="status" className="form-success">{notice}</p>}
    {!showCreate && saveState === "uncertain" && <p role="alert" className="form-error">The customer save outcome is unknown. Search customers to check; do not create the customer again.</p>}
    {!showCreate && customerWrite?.phase === "uncertain" && customerWrite.reviewed && <button type="button" className="btn" disabled={disabled || saving} onClick={() => {
      if (window.confirm("Have you reviewed the current customer records? This does not cancel the earlier request. Never repeat that customer creation; clear this warning only after checking for the saved customer.")) createMemory.clear(customerWrite.nonce);
    }}>Finish customer review</button>}
    {!showCreate && createdId && <div className="space-y-2"><p role="status">Customer created. Check its current access before selecting it; do not create it again.</p><button type="button" className="btn" disabled={disabled || saving} onClick={() => void checkSavedCustomer()}>Check saved customer</button></div>}
    {showCreate && <Modal labelledBy="enquiry-new-customer-title" onClose={close} busy={saving}>
      <form onSubmit={submitCustomer} className="space-y-4">
        <h2 id="enquiry-new-customer-title" className="text-xl font-semibold">Add customer for this enquiry</h2>
        <p className="text-sm text-slate-600">Your enquiry stays open. Creating a customer does not save the enquiry or send anything.</p>
        <fieldset disabled={saving || saveState !== "editing"} className="space-y-3">
          <div className="field"><label className="field-label" htmlFor="enquiry-customer-name">Full name</label><input id="enquiry-customer-name" className="control" autoFocus required maxLength={150} autoComplete="off" value={fields.name} onChange={event => change("name", event.target.value)} /></div>
          <div className="field"><label className="field-label" htmlFor="enquiry-customer-phone">Phone</label><input id="enquiry-customer-phone" className="control" type="tel" required maxLength={40} autoComplete="off" value={fields.phone} onChange={event => change("phone", event.target.value)} /></div>
          <div className="field"><label className="field-label" htmlFor="enquiry-customer-email">Email (optional)</label><input id="enquiry-customer-email" className="control" type="email" autoComplete="off" value={fields.email} onChange={event => change("email", event.target.value)} /></div>
          <div className="field"><label className="field-label" htmlFor="enquiry-customer-city">City (optional)</label><input id="enquiry-customer-city" className="control" maxLength={150} value={fields.city} onChange={event => change("city", event.target.value)} /></div>
          <div className="field"><label className="field-label" htmlFor="enquiry-customer-type">Customer type</label><select id="enquiry-customer-type" className="control" value={fields.type} onChange={event => change("type", event.target.value)}><option value="INDIVIDUAL">Individual</option><option value="CORPORATE">Corporate</option><option value="SUB_AGENT">Sub-agent</option></select></div>
        </fieldset>
        {saveError && <p ref={error} tabIndex={-1} role="alert" className="form-error">{saveError}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={saving} onClick={close}>{saveState === "editing" ? "Cancel customer" : "Return to enquiry"}</button>
          {saveState === "editing" && <button className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : "Create & select customer"}</button>}
          {createdId && <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void checkSavedCustomer()}>Check saved customer</button>}
        </div>
        {customerDirty && saveState === "editing" && <p className="text-sm text-slate-600">Use Cancel customer to discard these details. Your enquiry will stay open.</p>}
      </form>
    </Modal>}
  </section>;
}
