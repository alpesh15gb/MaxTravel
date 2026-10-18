"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Field, Status } from "@/components/ui";
import type { InvoiceConfig, InvoiceTaxProfile } from "@/lib/invoice-config";

const newProfile = (): InvoiceTaxProfile => ({ id: crypto.randomUUID(), label: "", components: [{ label: "", ratePercent: 0 }] });

export default function InvoiceSettings({ initial, canEdit }: { initial: InvoiceConfig; canEdit: boolean }) {
  const router = useRouter();
  const [config, setConfig] = useState<InvoiceConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const enabled = config.mode === "OPERATIONAL_AND_TAX";

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/settings/invoice-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not save invoice settings.");
      setSaved(true); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save invoice settings."); }
    finally { setBusy(false); }
  }

  function updateProfile(index: number, update: Partial<InvoiceTaxProfile>) {
    setConfig((current) => ({ ...current, profiles: current.profiles.map((profile, i) => i === index ? { ...profile, ...update } : profile) }));
  }

  return <form className="panel space-y-5 p-6" onSubmit={submit}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Invoice & tax settings</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Choose the document your team issues and enter the treatment approved by your accountant. These settings are copied onto each invoice when it is issued.</p></div><Status>{enabled ? "Tax invoice option enabled" : "Operational invoices"}</Status></div>
    <Field label="Invoice options"><select value={config.mode} onChange={(event) => setConfig({ ...config, mode: event.target.value as InvoiceConfig["mode"] })} disabled={!canEdit}><option value="OPERATIONAL_ONLY">Operational invoices only</option><option value="OPERATIONAL_AND_TAX">Allow operational and tax invoices</option></select></Field>
    {enabled && <>
      <div className="form-grid"><Field label="Legal issuer name *"><input required maxLength={120} value={config.issuerName} disabled={!canEdit} onChange={(event) => setConfig({ ...config, issuerName: event.target.value })}/></Field><Field label="Issuer GSTIN *" hint="Stored on new invoices as issued. Validate the registration with your accountant."><input required maxLength={15} className="uppercase" value={config.gstin} disabled={!canEdit} onChange={(event) => setConfig({ ...config, gstin: event.target.value.toUpperCase() })}/></Field></div>
      <Field label="Issuer address *"><textarea required maxLength={300} rows={2} value={config.address} disabled={!canEdit} onChange={(event) => setConfig({ ...config, address: event.target.value })}/></Field>
      <div className="form-grid"><Field label="Issuer state *"><input required maxLength={80} value={config.state} disabled={!canEdit} onChange={(event) => setConfig({ ...config, state: event.target.value })}/></Field><Field label="Default place of supply *"><input required maxLength={80} value={config.placeOfSupply} disabled={!canEdit} onChange={(event) => setConfig({ ...config, placeOfSupply: event.target.value })}/></Field></div>
      <div className="form-grid"><Field label="Document title"><input required maxLength={80} value={config.documentTitle} disabled={!canEdit} onChange={(event) => setConfig({ ...config, documentTitle: event.target.value })}/></Field><Field label="Footer / terms"><input maxLength={1000} value={config.footer} disabled={!canEdit} onChange={(event) => setConfig({ ...config, footer: event.target.value })}/></Field></div>
      <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Tax profiles</h3><p className="mt-1 text-xs text-slate-500">Set labels and rates exactly as your accountant instructs. Components apply to the invoice subtotal.</p></div>{canEdit&&<button type="button" className="btn-secondary" disabled={config.profiles.length >= 8} onClick={() => setConfig({ ...config, profiles: [...config.profiles, newProfile()] })}><Icon name="plus" size={16}/>Add profile</button>}</div>
        {config.profiles.map((profile, index) => <div key={profile.id} className="space-y-3 rounded-xl border border-slate-200 p-4"><div className="flex items-end gap-2"><Field label={`Profile ${index + 1} name`}><input required maxLength={80} placeholder="For example: domestic service" value={profile.label} disabled={!canEdit} onChange={(event) => updateProfile(index, { label: event.target.value })}/></Field>{canEdit&&<button type="button" className="mb-1 min-h-10 px-3 text-xs text-rose-700" aria-label={`Remove ${profile.label || `profile ${index + 1}`}`} onClick={() => setConfig({ ...config, profiles: config.profiles.filter((_, i) => i !== index) })}>Remove</button>}</div>
          {profile.components.map((component, componentIndex) => <div key={`${profile.id}-${componentIndex}`} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-end gap-2"><Field label={componentIndex === 0 ? "Tax label" : `Tax label ${componentIndex + 1}`}><input required maxLength={48} placeholder="Accountant-approved tax name" value={component.label} disabled={!canEdit} onChange={(event) => updateProfile(index, { components: profile.components.map((item, i) => i === componentIndex ? { ...item, label: event.target.value } : item) })}/></Field><Field label="Rate (%)"><input type="number" min="0" max="100" step="0.01" required value={component.ratePercent} disabled={!canEdit} onChange={(event) => updateProfile(index, { components: profile.components.map((item, i) => i === componentIndex ? { ...item, ratePercent: Number(event.target.value) } : item) })}/></Field>{canEdit&&<button type="button" className="mb-1 min-h-10 px-2 text-xs text-slate-500" disabled={profile.components.length <= 1} onClick={() => updateProfile(index, { components: profile.components.filter((_, i) => i !== componentIndex) })}>Remove</button>}</div>)}
          {canEdit&&<button type="button" className="text-xs font-semibold text-teal-700" disabled={profile.components.length >= 5} onClick={() => updateProfile(index, { components: [...profile.components, { label: "", ratePercent: 0 }] })}>Add a tax component</button>}
        </div>)}
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950"><input type="checkbox" className="mt-1" checked={config.accountantApproved} disabled={!canEdit} onChange={(event) => setConfig({ ...config, accountantApproved: event.target.checked })}/><span>I confirm the issuer details, document title, tax labels, rates and invoice treatment above were reviewed and approved by our accountant. The CRM applies configured arithmetic and does not determine legal tax applicability.</span></label>
    </>}
    {error&&<div role="alert" className="form-error">{error}</div>}{saved&&<div role="status" className="form-success">Invoice settings saved. New invoices will use a frozen copy of these values.</div>}
    {canEdit&&<button className="btn-primary" disabled={busy}>{busy?"Saving…":"Save invoice settings"}<Icon name="check" size={16}/></button>}
  </form>;
}
