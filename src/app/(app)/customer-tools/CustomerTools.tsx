"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
type Data={canMerge:boolean;customers:{id:string;code:string;name:string}[];branches:{id:string;name:string;code:string}[];defaultBranch:string|null;duplicates:{id:string;code:string;name:string}[][]};type Preview={rows:{name:string;phone:string;email?:string}[];duplicates:number[];requestId:string};
export default function CustomerTools(){
 const [data,setData]=useState<Data|null>(null),[csv,setCsv]=useState(""),[branch,setBranch]=useState(""),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [fileLoading,setFileLoading]=useState(false),[unresolved,setUnresolved]=useState(false);
 const generation=useRef(0),requestActive=useRef(false);
 const pendingImport=useRef<{csv:string;branchId:string;requestId:string}|null>(null);
 useEffect(()=>{fetch("/api/customers/tools").then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error??"Cannot load customer tools.");setData(d);setBranch(d.defaultBranch??d.branches[0]?.id??"");}).catch(e=>setError(e.message));},[]);
 // Selection is a new draft immediately, before file validation or asynchronous reads.
 function invalidateDraft(){
  if(pendingImport.current)return null;
  const revision=++generation.current;setPreview(null);setError("");setMessage("");setFileLoading(false);return revision;
 }
 async function selectFile(file:File|undefined){
  const revision=invalidateDraft();if(revision===null)return;setCsv("");
  if(!file)return;
  if(file.size>512000){setError("Use a CSV file up to 512 KB.");return;}
  setFileLoading(true);
  try{const content=await file.text();if(generation.current===revision)setCsv(content);}
  catch{if(generation.current===revision)setError("Cannot read this CSV file. Select it again or choose another file.");}
  finally{if(generation.current===revision)setFileLoading(false);}
 }
 async function run(action:"preview"|"commit"){
  if(requestActive.current||fileLoading||(action==="preview"&&pendingImport.current))return;
  const recovering=Boolean(pendingImport.current);
  if(action==="commit"&&!pendingImport.current){
   if(!preview||preview.duplicates.length)return;
   pendingImport.current={csv,branchId:branch,requestId:preview.requestId};setUnresolved(true);
  }
  const revision=generation.current,body=action==="commit"?{action,...pendingImport.current!}:{action,csv,branchId:branch};
  requestActive.current=true;setBusy(true);setError("");setMessage("");
  try{
   const r=await fetch("/api/customers/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   // A definite rejection did not import; a lost/5xx acknowledgement must keep the exact retry snapshot.
   if(action==="commit"&&!recovering&&!r.ok&&r.status<500){pendingImport.current=null;setUnresolved(false);}
   const d=await r.json();if(!r.ok)throw Error(d.error??"Import failed.");
   if(action==="preview"){if(generation.current===revision)setPreview(d);}
   else{pendingImport.current=null;setUnresolved(false);++generation.current;setMessage(`Imported ${d.created} customers. Automatic WhatsApp consent is off for imported records.`);setPreview(null);setCsv("");}
  }catch(e){
   if(action==="commit"&&pendingImport.current)setError("Import outcome could not be confirmed. Retry the unchanged import to recover its result; do not submit a new file.");
   else if(generation.current===revision)setError(e instanceof Error?e.message:"Import failed.");
  }finally{requestActive.current=false;setBusy(false);}
 }
 return <div className="workspace-page space-y-6"><h1 className="text-2xl font-semibold">Customer import & duplicate review</h1>{error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status" className="form-success">{message}</p>}<section className="panel p-6 space-y-4"><h2 className="font-semibold">Import up to 200 customers from CSV</h2><p className="text-sm">Required headers: name,phone. Optional: email,city,address,companyName,type,gstNumber. Include international country codes in phone numbers. Existing contacts are flagged; they are never overwritten.</p><label className="block">Branch<select className="control" value={branch} disabled={unresolved} onChange={e=>{if(invalidateDraft()!==null)setBranch(e.target.value);}}>{data?.branches.map(b=><option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}</select></label><label className="block">CSV file<input className="control" type="file" accept=".csv,text/csv" disabled={unresolved} onChange={e=>{void selectFile(e.target.files?.[0]);}}/></label><label className="block">CSV content<textarea className="control font-mono text-sm" rows={8} value={csv} disabled={unresolved} onChange={e=>{if(invalidateDraft()!==null)setCsv(e.target.value);}} placeholder={'name,phone,email,city\nCustomer name,+919876543210,customer@example.com,Mumbai'}/></label><button className="btn-secondary" disabled={busy||fileLoading||unresolved||!csv||!branch} onClick={()=>run("preview")}>Validate & preview</button>{fileLoading&&<p role="status">Reading the selected CSV file…</p>}{unresolved&&<p className="text-sm">Keep this page open. The import draft is locked until its outcome is confirmed; retry uses the same request.</p>}{preview&&<div className="space-y-3"><p>{preview.rows.length} valid rows · {preview.duplicates.length} contact duplicates</p>{preview.duplicates.length>0&&<p role="alert">Resolve duplicate contacts in CSV rows: {preview.duplicates.join(", ")}. Import is blocked until corrected.</p>}<div className="max-h-64 overflow-auto">{preview.rows.map((row,i)=><p key={i} className="border-b py-2">Row {i+2}: {row.name} · {row.phone} · {row.email??""}</p>)}</div><button className="btn-primary" disabled={busy||fileLoading||preview.duplicates.length>0} onClick={()=>run("commit")}>Import these customers</button></div>}</section><section className="panel p-6 space-y-4"><h2 className="font-semibold">Existing duplicate contacts</h2><p className="text-sm">Review ownership and financial history before consolidating records. Sources with bookings, visa cases, financial history or platform identities are blocked. A consolidated source stays inactive, its private upload links are revoked and messaging consent must be reviewed.</p>{data?.duplicates.length===0&&<p>No duplicate contacts found within the reviewed scope.</p>}{data?.duplicates.map((group,i)=><div key={i} className="rounded-xl border p-4">{group.map(c=><Link key={c.id} className="block text-teal-700" href={`/customers/${c.id}`}>{c.code} · {c.name}</Link>)}</div>)}</section>{data?.canMerge&&<section className="panel p-6 space-y-4"><h2 className="font-semibold">Consolidate a duplicate without financial history</h2><form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(requestActive.current||pendingImport.current)return;requestActive.current=true;const f=new FormData(e.currentTarget);setBusy(true);setError("");try{const r=await fetch("/api/customers/merge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceId:f.get("sourceId"),targetId:f.get("targetId"),confirm:f.get("confirm")})});const d=await r.json();if(!r.ok)throw Error(d.error??"Consolidation failed.");window.location.assign(`/customers/${d.targetId}`);}catch(e){setError(e instanceof Error?e.message:"Consolidation failed.");}finally{requestActive.current=false;setBusy(false);}}}><label className="block">Duplicate source profile<select className="control" name="sourceId" required><option value="">Select source to retire</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label className="block">Retained customer profile<select className="control" name="targetId" required><option value="">Select profile to keep</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label className="block">Type SOURCE-CODE -&gt; TARGET-CODE exactly<input className="control" required name="confirm" placeholder="C-2026-0001 -> C-2026-0002"/></label><button className="btn-primary" disabled={busy||unresolved}>Consolidate selected profiles</button></form></section>}</div>;}
