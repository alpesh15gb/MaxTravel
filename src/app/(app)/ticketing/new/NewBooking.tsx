"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import TransactionSteps from "@/components/TransactionSteps";
import { PageHeader, EmptyState, Field } from "@/components/ui";
import { inrAmount } from "@/lib/money";
type Customer={id:string;name:string;code:string;travellers:{id:string;fullName:string;relation:string}[]};
const STEPS=["Customer & travellers","Travel details","Price & review"];

export default function NewBooking({customers,suppliers,defaultCustomerId,defaultProduct="FLIGHT"}:{customers:Customer[];suppliers:{id:string;name:string}[];defaultCustomerId:string|null;defaultProduct?:"FLIGHT"|"HOTEL"}) {
  const router=useRouter();
  const [step,setStep]=useState(0),[product,setProduct]=useState(defaultProduct);
  const [customerId,setCustomer]=useState(customers.some(c=>c.id===defaultCustomerId)?defaultCustomerId!:"");
  const [travellerIds,setTravellers]=useState<string[]>([]);
  const [form,setForm]=useState({pnr:"",airline:"",gdsSource:"",supplierId:"",sector:"",flightNo:"",travelDate:"",deadlineHours:"24",fare:"",taxes:"",markup:"",serviceFee:"",supplierCost:"",hotelName:"",hotelCheckIn:"",hotelCheckOut:""});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[step]);
  const customer=customers.find(c=>c.id===customerId);
  const total=Number(form.fare)+Number(form.taxes)+Number(form.markup)+Number(form.serviceFee);
  const priceEntered=[form.fare,form.taxes,form.markup,form.serviceFee].some(value=>value!=="");
  const update=(key:keyof typeof form,value:string)=>setForm(previous=>({...previous,[key]:value}));
  const input=(key:keyof typeof form,label:string,type="text",required=false)=><Field label={label}><input type={type} required={required} value={form[key]} onChange={e=>update(key,e.target.value)} min={type==="number"?0:undefined} step={type==="number"?"0.01":undefined}/></Field>;
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy||uncertain)return; setError("");
    if(!event.currentTarget.reportValidity())return;
    if(!customerId||!travellerIds.length){setError("Choose a customer and at least one traveller.");setStep(0);return;}
    if(step===1&&product==="HOTEL"&&form.hotelCheckOut<=form.hotelCheckIn){setError("Check-out must be after check-in.");return;}
    if(step<2){setStep(value=>value+1);return;}
    setBusy(true);
    try {
      const response=await fetch("/api/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,product,customerId,travellerIds})});
      const data=await response.json();
      if(!response.ok){if(response.status>=500)setUncertain(true);setError(data.error??"The booking could not be saved. Check the booking list before retrying.");return;}
      if(!data.bookingId)throw Error("Missing booking reference");
      router.push(`/ticketing/${data.bookingId}`);
    } catch {setUncertain(true);setError("The save response was interrupted. Check the booking list for an existing record before creating another. Your form is preserved here.");}
    finally {setBusy(false);}
  }
  return <div className="workspace-page"><PageHeader eyebrow="Travel operations" title="Create a booking" description="A short guided flow, with a review before anything is saved." actions={<Link className="btn-secondary" href="/ticketing">Back to bookings</Link>}/>
    {!customers.length?<EmptyState icon="customers" title="Add a customer first" description="Every booking belongs to a real customer and their travellers." href="/customers?action=new" action="Add a customer"/>:<>
      <TransactionSteps labels={STEPS} current={step}/>
      <div className="transaction-layout"><form className="panel transaction-form" noValidate onSubmit={submit}>
        <fieldset hidden={step!==0} disabled={busy||step!==0}><h2 ref={step===0?heading:undefined} tabIndex={-1}>Who is this booking for?</h2><p className="step-description">Choose the paying customer, then select the people travelling.</p>
          <Field label="Customer *"><select required value={customerId} onChange={e=>{setCustomer(e.target.value);setTravellers([]);}}><option value="">Choose a customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</select></Field>
          {customer&&<div className="traveller-options" role="group" aria-label="Travellers">{customer.travellers.map(t=><label key={t.id} className="traveller-option"><input type="checkbox" checked={travellerIds.includes(t.id)} onChange={e=>setTravellers(previous=>e.target.checked?[...previous,t.id]:previous.filter(id=>id!==t.id))}/><span>{t.fullName}</span></label>)}{!customer.travellers.length&&<p className="step-description">Add a traveller in <Link className="underline text-blue-700" href={`/customers/${customer.id}?tab=travellers`}>the customer record</Link> first.</p>}</div>}
        </fieldset>
        <fieldset hidden={step!==1} disabled={busy||step!==1}><h2 ref={step===1?heading:undefined} tabIndex={-1}>What are they booking?</h2><p className="step-description">Use the actual itinerary and references from your supplier. Confirmation remains a separate step on the booking record.</p>
          <div className="form-grid"><Field label="Service"><select value={product} onChange={e=>{setProduct(e.target.value as "FLIGHT"|"HOTEL");update("pnr","");}}><option value="FLIGHT">Flight</option><option value="HOTEL">Hotel stay</option></select></Field>
          {product==="FLIGHT"?<>{input("sector","Route / sector *","text",true)}{input("travelDate","Travel date","date")}{input("airline","Airline")}{input("pnr","Actual PNR (optional)")}{form.pnr&&input("deadlineHours","Ticketing deadline (hours from now)","number")}{input("flightNo","Flight number")}</>:<>{input("hotelName","Hotel name *","text",true)}{input("hotelCheckIn","Check-in *","date",true)}{input("hotelCheckOut","Check-out *","date",true)}{input("sector","Destination / city")}{input("pnr","Supplier confirmation reference (optional)")}</>}
          <Field label="Supplier"><select value={form.supplierId} onChange={e=>update("supplierId",e.target.value)}><option value="">Not assigned</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          {product==="FLIGHT"&&<Field label="Booking source"><select value={form.gdsSource} onChange={e=>update("gdsSource",e.target.value)}><option value="">Not specified</option>{["Amadeus","Sabre","Galileo","Direct"].map(source=><option key={source}>{source}</option>)}</select></Field>}</div>
        </fieldset>
        <fieldset hidden={step!==2} disabled={busy||step!==2}><h2 ref={step===2?heading:undefined} tabIndex={-1}>Review the booking & price</h2><p className="step-description">Review the customer, travel and selling price. Recording this transaction does not issue a supplier ticket or collect money.</p>
          <dl className="transaction-review"><div><dt>Customer</dt><dd>{customer?.name}</dd></div><div><dt>Travellers</dt><dd>{customer?.travellers.filter(t=>travellerIds.includes(t.id)).map(t=>t.fullName).join(", ")}</dd></div><div><dt>{product==="HOTEL"?"Hotel stay":"Flight itinerary"}</dt><dd>{product==="HOTEL"?`${form.hotelName} · ${form.hotelCheckIn}–${form.hotelCheckOut}`:form.sector}</dd></div><div><dt>Initial CRM status</dt><dd>{product==="FLIGHT"&&form.pnr?"PNR created":"Enquiry"} · check supplier confirmation on the record</dd></div></dl>
          <div className="form-grid">{input("fare",product==="HOTEL"?"Stay price before taxes (INR)":"Fare (INR)","number")}{input("taxes","Taxes (INR)","number")}{input("markup","Markup (INR)","number")}{input("serviceFee","Service fee (INR)","number")}{input("supplierCost","Known supplier cost (INR)","number")}</div>
        </fieldset>
        {error&&<div role="alert" className="form-error mt-5">{error}{uncertain&&<Link className="mt-2 block underline" href="/ticketing" target="_blank" rel="noopener noreferrer">Check existing bookings in a new tab</Link>}</div>}
        <div className="transaction-navigation"><button className="btn-secondary" type="button" disabled={busy||step===0} onClick={()=>{setError("");setStep(value=>value-1);}}>Back</button><span className="text-xs text-slate-600">Step {step+1} of 3</span><button className="btn-primary" disabled={busy||uncertain}>{busy?"Creating…":step===2?"Create booking":"Continue"}<Icon name="arrow" size={16}/></button></div>
      </form><aside className="transaction-context" aria-label="Booking summary"><h2>Booking summary</h2><dl><div><dt>Customer</dt><dd>{customer?.name||"Not selected"}</dd></div><div><dt>Travellers</dt><dd>{travellerIds.length?`${travellerIds.length} selected`:"Not selected"}</dd></div><div><dt>Service</dt><dd>{product==="HOTEL"?"Hotel stay":"Flight"}</dd></div><div><dt>Itinerary</dt><dd>{product==="HOTEL"?form.hotelName||"Not entered":form.sector||"Not entered"}</dd></div></dl><div className="context-total"><span className="text-xs text-slate-600">Customer selling price</span><strong>{priceEntered?inrAmount(total):"Not entered"}</strong><p className="mt-2 text-xs text-slate-600">A receipt is recorded separately when money is received.</p></div></aside></div>
    </>}
  </div>;
}
