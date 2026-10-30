"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import TransactionSteps from "@/components/TransactionSteps";
import { PageHeader, EmptyState, Field } from "@/components/ui";
import { checklistMatches } from "@/lib/visa-checklist";
import { inrAmount } from "@/lib/money";
type Customer={id:string;name:string;code:string;travellers:{id:string;fullName:string;relation:string}[]};
type Checklist={id:string;country:string;visaType:string;applicantType:string;version:number};
const STEPS=["Customer & applicants","Requirements","Fees & review"];
export default function NewVisaCase({customers,checklists,defaultCustomerId,canCreate}:{customers:Customer[];checklists:Checklist[];defaultCustomerId:string|null;canCreate:boolean}) {
  const router=useRouter();
  const [step,setStep]=useState(0),[customerId,setCustomer]=useState(customers.some(c=>c.id===defaultCustomerId)?defaultCustomerId!:"");
  const [travellerIds,setTravellers]=useState<string[]>([]),[checklistId,setChecklist]=useState("");
  const [form,setForm]=useState({destination:"",visaType:"",visaCategory:"",travelDate:"",intendedStay:"",visaFee:"",serviceFee:"",notes:""});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[step]);
  const customer=customers.find(c=>c.id===customerId),total=Number(form.visaFee)+Number(form.serviceFee);
  const priceEntered=form.visaFee!==""||form.serviceFee!=="";
  const matching=checklists.filter(checklist=>checklistMatches(checklist,form.destination,form.visaType));
  const selectedChecklist=matching.find(checklist=>checklist.id===checklistId);
  const update=(key:keyof typeof form,value:string)=>setForm(previous=>({...previous,[key]:value}));
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy||uncertain)return;setError("");
    if(!event.currentTarget.reportValidity())return;
    if(!customerId||!travellerIds.length){setStep(0);setError("Choose the customer and at least one applicant.");return;}
    if(step<2){setStep(value=>value+1);return;}
    setBusy(true);
    try {
      const response=await fetch("/api/visa/cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,customerId,travellerIds,checklistId})});
      const data=await response.json();
      if(!response.ok){if(response.status>=500)setUncertain(true);setError(data.error??"The case could not be saved. Check the case list before trying again.");return;}
      if(!data.caseId)throw Error("Missing case reference");
      router.push(`/visa/${data.caseId}`);
    } catch {setUncertain(true);setError("The save response was interrupted. Check the case list before creating another case. Your form is preserved here.");}
    finally {setBusy(false);}
  }
  return <div className="workspace-page"><PageHeader eyebrow="Visa operations" title="Start a visa case" description="Applicants first, the correct requirements next, then a clear fee review." actions={<Link href="/visa" className="btn-secondary">Back to cases</Link>}/>
    {!canCreate?<EmptyState title="Creation is restricted" description="Your role cannot create visa cases."/>:!customers.length?<EmptyState icon="customers" title="Start with a customer" description="Add the customer and their travellers before opening the application." href="/customers?action=new" action="Add a customer"/>:<>
      <TransactionSteps labels={STEPS} current={step}/><div className="transaction-layout"><form noValidate onSubmit={submit} className="panel transaction-form">
        <fieldset hidden={step!==0} disabled={busy||step!==0}><h2 ref={step===0?heading:undefined} tabIndex={-1}>Who is applying?</h2><p className="step-description">Select the customer and each applicant. Document requirements are tracked separately for every person.</p><Field label="Customer *"><select required value={customerId} onChange={e=>{setCustomer(e.target.value);setTravellers([]);}}><option value="">Choose a customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</select></Field>
          {customer&&<div className="traveller-options" role="group" aria-label="Applicants">{customer.travellers.map(t=><label key={t.id} className="traveller-option"><input type="checkbox" checked={travellerIds.includes(t.id)} onChange={e=>setTravellers(previous=>e.target.checked?[...previous,t.id]:previous.filter(id=>id!==t.id))}/><span>{t.fullName}{" "}<small className="ml-2 text-slate-600">{t.relation.toLowerCase()}</small></span></label>)}{!customer.travellers.length&&<Link className="text-blue-700 underline" href={`/customers/${customer.id}?tab=travellers`}>Add an applicant to the customer record first</Link>}</div>}
        </fieldset>
        <fieldset hidden={step!==1} disabled={busy||step!==1}><h2 ref={step===1?heading:undefined} tabIndex={-1}>Where are they going?</h2><p className="step-description">Set the country and visa type, then choose the matching agency checklist.</p><div className="form-grid"><Field label="Destination country *"><input required value={form.destination} onChange={e=>{update("destination",e.target.value);setChecklist("");}} placeholder="Destination country"/></Field><Field label="Visa type *"><input required value={form.visaType} onChange={e=>{update("visaType",e.target.value);setChecklist("");}} placeholder="Tourist, business, student…"/></Field><Field label="Travel date"><input type="date" value={form.travelDate} onChange={e=>update("travelDate",e.target.value)}/></Field><Field label="Checklist" hint="Only templates matching this country and visa type are offered."><select value={checklistId} onChange={e=>setChecklist(e.target.value)}><option value="">No checklist yet</option>{matching.map(c=><option key={c.id} value={c.id}>{c.country} · {c.visaType} · {c.applicantType} · v{c.version}</option>)}</select></Field></div>
          {form.destination&&form.visaType&&!matching.length&&<p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">No matching checklist is configured. You can open the enquiry now; configure the requirements before requesting documents.</p>}
          <details className="mt-5 rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Optional application details</summary><div className="form-grid mt-4"><Field label="Visa category"><input value={form.visaCategory} onChange={e=>update("visaCategory",e.target.value)}/></Field><Field label="Intended stay"><input value={form.intendedStay} onChange={e=>update("intendedStay",e.target.value)}/></Field></div><div className="mt-4"><Field label="Internal notes"><textarea rows={3} value={form.notes} onChange={e=>update("notes",e.target.value)}/></Field></div></details>
        </fieldset>
        <fieldset hidden={step!==2} disabled={busy||step!==2}><h2 ref={step===2?heading:undefined} tabIndex={-1}>Review the case & fees</h2><p className="step-description">Confirm the applicants and requirements, then enter the agency selling price.</p><dl className="transaction-review"><div><dt>Customer</dt><dd>{customer?.name}</dd></div><div><dt>Applicants</dt><dd>{customer?.travellers.filter(t=>travellerIds.includes(t.id)).map(t=>t.fullName).join(", ")}</dd></div><div><dt>Application</dt><dd>{form.destination} · {form.visaType}</dd></div><div><dt>Requirements</dt><dd>{selectedChecklist?`${selectedChecklist.country} · version ${selectedChecklist.version}`:"No checklist selected"}</dd></div></dl><div className="form-grid"><Field label="Visa fee (INR)"><input type="number" min={0} step="0.01" value={form.visaFee} onChange={e=>update("visaFee",e.target.value)}/></Field><Field label="Service fee (INR)"><input type="number" min={0} step="0.01" value={form.serviceFee} onChange={e=>update("serviceFee",e.target.value)}/></Field></div><p className="mt-5 text-sm leading-6 text-slate-600">Document requests are queued only when required documents, customer consent and the agency document-request rule permit it. Creating the case does not collect money.</p></fieldset>
        {error&&<div role="alert" className="form-error mt-5">{error}{uncertain&&<Link className="mt-2 block underline" href="/visa" target="_blank" rel="noopener noreferrer">Check existing visa cases in a new tab</Link>}</div>}
        <div className="transaction-navigation"><button type="button" className="btn-secondary" disabled={busy||step===0} onClick={()=>{setError("");setStep(value=>value-1);}}>Back</button><span className="text-xs text-slate-600">Step {step+1} of 3</span><button className="btn-primary" disabled={busy||uncertain}>{busy?"Creating…":step===2?"Create visa case":"Continue"}<Icon name="arrow" size={16}/></button></div>
      </form><aside className="transaction-context" aria-label="Visa case summary"><h2>Case summary</h2><dl><div><dt>Customer</dt><dd>{customer?.name||"Not selected"}</dd></div><div><dt>Applicants</dt><dd>{travellerIds.length?`${travellerIds.length} selected`:"Not selected"}</dd></div><div><dt>Destination</dt><dd>{form.destination||"Not entered"}</dd></div><div><dt>Visa type</dt><dd>{form.visaType||"Not entered"}</dd></div><div><dt>Checklist</dt><dd>{selectedChecklist?`Version ${selectedChecklist.version}`:"Not selected"}</dd></div></dl><div className="context-total"><span className="text-xs text-slate-600">Total selling price</span><strong>{priceEntered?inrAmount(total):"Not entered"}</strong></div></aside></div>
    </>}
  </div>;
}
