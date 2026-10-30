"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import ReportsClient from "./ReportsClient";
import { PageHeader, EmptyState, Field } from "@/components/ui";
import { inrAmount } from "@/lib/money";
import type { AccountReport, ReportRow } from "@/lib/account-reports";
import { REPORT_CATALOGUE, REPORT_GROUPS, REPORT_DATE_PRESETS, indiaDay, isBalanceReport, isStatementReport, isWorkReport, reportCurrency, reportDatePreset, reportDefinition, reportFilterQuery } from "@/lib/report-workspace";
import { readReportJson } from "@/lib/report-read";
import type { ReportFilters } from "@/lib/report-workspace";
import "./reporting-workspace.css";

type Options = { customers: { id: string; name: string; code: string }[]; suppliers: { id: string; name: string }[]; staff: { id: string; name: string }[]; statuses: string[]; cutover: string | null };
type Props = { canExport: boolean; canSupplier: boolean; canRefund: boolean; canTerms: boolean; initialReport?: string; initialCustomer?: string; initialFilters?: Partial<ReportFilters> };
export default function ReportCentreClient({ canExport, canSupplier, canRefund, canTerms, initialReport, initialCustomer, initialFilters={} }: Props) {
 const available = REPORT_CATALOGUE.filter(r => (!r.key.startsWith("supplier") || canSupplier) && (r.key !== "refunds" || canRefund));
 const [selected, setSelected] = useState(initialReport === "overview" || available.some(r => r.key === initialReport) ? initialReport! : "ageing");
 const [search, setSearch] = useState("");
 const [library, setLibrary] = useState(false), [linkNotice, setLinkNotice] = useState("");
 const [options, setOptions] = useState<Options | null>(null), [optionsError, setOptionsError] = useState("");
 const [customerId, setCustomer] = useState(initialCustomer || ""), [supplierId, setSupplier] = useState(initialFilters.supplierId||"");
 const [ownerId, setOwner] = useState(initialFilters.ownerId||""), [status, setStatus] = useState(initialFilters.status||"");
 const [from, setFrom] = useState(initialFilters.from||""), [to, setTo] = useState(initialFilters.to||"");
 const [data, setData] = useState<AccountReport | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
 const [terms, setTerms] = useState(false), [applied, setApplied] = useState("");
 const request = useRef<AbortController | null>(null), optionsRequest = useRef<AbortController | null>(null);
 const generation = useRef(0), optionsGeneration = useRef(0);
 const lastRequest = useRef<{ page: number; query: string } | null>(null);
 const loadOptions = useCallback(async () => {
  optionsRequest.current?.abort(); const c = new AbortController(); optionsRequest.current = c; const id = ++optionsGeneration.current;
  setOptionsError("");
  try {
   const { response: r, data: d } = await readReportJson<Options & { error?: string }>("/api/reports/accounts?options=1", { signal: c.signal });
   if (c.signal.aborted || id !== optionsGeneration.current) return;
   if (!r.ok) throw new Error(d.error || "Could not load report accounts.");
   setOptions(d);
   const dates = reportDatePreset("month", "statement", d.cutover) || { from: indiaDay(), to: indiaDay() };
   setFrom(value => value || dates.from); setTo(value => value || dates.to);
  } catch (e) { if (!c.signal.aborted && id === optionsGeneration.current) setOptionsError(e instanceof Error ? e.message : "Could not load report accounts."); }
 }, []);
 useEffect(() => { void loadOptions(); return () => { optionsRequest.current?.abort(); request.current?.abort(); }; }, [loadOptions]);
 const supplier = selected.startsWith("supplier"), statement = isStatementReport(selected), balance = isBalanceReport(selected), workReport = isWorkReport(selected);
 const chosen = reportDefinition(selected);
 const cutoff = options?.cutover ? indiaDay(new Date(options.cutover)) : undefined;
 const draftQuery = reportFilterQuery({ report: selected, from, to, customerId, supplierId, ownerId, status });
 const unapplied = Boolean(data && applied && draftQuery !== applied);
 const matches = available.filter(r => `${r.label} ${r.hint} ${r.group}`.toLowerCase().includes(search.trim().toLowerCase()));
 const overviewMatches = "Business overview sales cash outstanding workload".toLowerCase().includes(search.trim().toLowerCase());
 function choose(key: string) {
  ++generation.current; request.current?.abort(); setSelected(key); setData(null); setError(""); setBusy(false); setApplied(""); setTerms(false); setLibrary(false); setLinkNotice(""); lastRequest.current = null;
  window.history.replaceState(null,"",`/reports?${new URLSearchParams({report:key})}`);
 }
 async function load(page = 1, query = draftQuery) {
  request.current?.abort(); const c = new AbortController(); request.current = c; const id = ++generation.current;
  setBusy(true); setError(""); setData(null); setTerms(false);
  const p = new URLSearchParams(query); p.delete("page"); lastRequest.current = { page, query: p.toString() }; p.set("page", String(page));
  try {
   const { response: r, data: d } = await readReportJson<AccountReport & { error?: string }>("/api/reports/accounts?" + p, { signal: c.signal });
   if (c.signal.aborted || id !== generation.current) return;
   if (!r.ok) throw new Error(d.error || "Could not load report.");
   setData(d); p.delete("page"); setApplied(p.toString()); setLinkNotice("");
   window.history.replaceState(null,"",`/reports?${p}`);
  } catch (e) { if (!c.signal.aborted && id === generation.current) setError(e instanceof Error ? e.message : "Could not load report."); }
  finally { if (!c.signal.aborted && id === generation.current) setBusy(false); }
 }
 function restoreApplied() {
  const p = new URLSearchParams(applied); setFrom(p.get("from") || ""); setTo(p.get("to") || ""); setCustomer(p.get("customerId") || ""); setSupplier(p.get("supplierId") || ""); setOwner(p.get("ownerId") || ""); setStatus(p.get("status") || "");
 }
 const editableTermsRows = data?.rows.filter(row => row._termsEditable === 1) || [];
 const appliedCustomer = new URLSearchParams(applied).get("customerId");
 return <div className="workspace-page reporting-desk">
  <PageHeader eyebrow="Agency reporting" title="Reports & insights" description="Answer a business question, check the source records, and take the next action." actions={<button type="button" className="btn-secondary" onClick={()=>setLibrary(true)}>Browse report library</button>}/>
  <section className="report-launchbar panel no-print" aria-label="Find a report"><Field label="Choose a report"><select value={selected} onChange={e=>choose(e.target.value)}>{REPORT_GROUPS.map(group=><optgroup key={group} label={group}>{available.filter(report=>report.group===group).map(report=><option key={report.key} value={report.key}>{report.label}</option>)}</optgroup>)}<option value="overview">Business overview</option></select></Field><div><span className="report-mode-label">{selected==="overview"?"Business overview":balance?"As-of balance":statement?"Account movements":"Period activity"}</span><p>{chosen?.hint||"Sales, cash, outstanding work and the records behind them."}</p></div></section>
  {library&&<Modal labelledBy="report-library-title" width="max-w-4xl" onClose={()=>setLibrary(false)}><div className="report-library"><div className="flex justify-between items-start gap-4"><div><p className="eyebrow">Choose the question</p><h2 id="report-library-title">Report library</h2></div><button type="button" className="btn-secondary" onClick={()=>setLibrary(false)}>Close</button></div><Field label="Search reports"><input autoFocus type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer balance, supplier, sales, refunds…"/></Field>{search&&<button type="button" className="report-link-action" onClick={()=>setSearch("")}>Clear search</button>}<nav aria-label="Report catalogue">{REPORT_GROUPS.map(group=>{const entries=matches.filter(report=>report.group===group);return entries.length?<section key={group}><h3>{group}</h3><div className="report-library-grid">{entries.map(report=><button type="button" className="report-library-card" aria-label={report.label} aria-pressed={selected===report.key} key={report.key} onClick={()=>choose(report.key)}><strong>{report.label}</strong><span>{report.hint}</span><small>{report.basis}</small></button>)}</div></section>:null;})}{overviewMatches&&<button className="report-library-card" type="button" aria-label="Business overview" aria-pressed={selected==="overview"} onClick={()=>choose("overview")}><strong>Business overview</strong><span>How are sales, cash, outstanding balances and workload moving?</span></button>}</nav>{!matches.length&&!overviewMatches&&<p role="status">No permitted reports match this search.</p>}</div></Modal>}
  {selected === "overview" ? <ReportsClient canExport={canExport} embedded initialFrom={initialFilters.from} initialTo={initialFilters.to} /> : <>
   <div className="report-selection-heading"><h2>{chosen?.label||"Financial report"}</h2><button className="btn-primary" type="submit" form="report-filters" disabled={busy || !options}>{busy ? "Generating…" : "Generate report"}</button></div>
   <div className="report-basis mb-4"><strong>Date basis</strong><span>{chosen?.basis}</span><span>India calendar · {reportCurrency(selected)}</span></div>
   {optionsError && <div role="alert" className="panel p-4 mb-4"><p className="form-error">{optionsError}</p><button type="button" className="btn-secondary mt-2" onClick={() => void loadOptions()}>Retry loading report accounts</button></div>}
   {!options && !optionsError && <p role="status" className="text-sm mb-4">Loading permitted report accounts…</p>}
   <form id="report-filters" className="panel mb-5 p-5 space-y-4 no-print" onSubmit={e => { e.preventDefault(); void load(); }}>
    <div><div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">{REPORT_DATE_PRESETS.filter(p => !balance || p.key === "today" || p.key === "previousMonth").map(p => {
     const dates = reportDatePreset(p.key, selected, options?.cutover || null);
     return <button key={p.key} type="button" className="btn-secondary" disabled={!options || !dates} title={!dates ? "Before preserved balance history" : undefined} onClick={() => { if (dates) { setFrom(dates.from); setTo(dates.to); } }}>{balance && p.key === "previousMonth" ? "Last month end" : p.label}</button>;
    })}</div><p className="text-xs text-slate-600 mt-2">Quick dates edit the filters only. Select Generate report or Apply report filters to apply them.</p></div>
    <div className="form-grid">
     {!supplier ? <Field label={statement ? "Customer *" : "Customer"}><select required={statement} value={customerId} onChange={e => setCustomer(e.target.value)}><option value="">{statement ? "Choose customer" : "All permitted customers"}</option>{options?.customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</select></Field> : selected === "supplier-statement" ? <Field label="Supplier *"><select required value={supplierId} onChange={e => setSupplier(e.target.value)}><option value="">Choose supplier</option>{options?.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field> : null}
     {workReport && <><Field label="Staff / owner"><select value={ownerId} onChange={e => setOwner(e.target.value)}><option value="">All permitted staff</option>{options?.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Current status / stage"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{options?.statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></Field></>}
     {!balance && <Field label="From"><input type="date" required min={statement ? cutoff : undefined} max={to || indiaDay()} value={from} onChange={e => setFrom(e.target.value)} /></Field>}
     <Field label={balance ? "Balance as of" : "Through"}><input type="date" required min={balance ? cutoff : from || undefined} max={indiaDay()} value={to} onChange={e => setTo(e.target.value)} /></Field>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">India calendar · {balance ? "single end-of-day balance cutoff" : "maximum 366 days"}{selected === "cancellations" ? " · Filtered by cancellation date, not booking date" : ""}{chosen?.cutoff && cutoff ? ` · Preserved balances from ${cutoff}` : ""}</p><button className="btn-secondary" type="button" disabled={busy || !options} onClick={event => event.currentTarget.form?.requestSubmit()}>{busy ? "Generating…" : "Apply report filters"}</button></div>
   </form>
   {unapplied && <div role="status" className="panel p-4 mb-5 border-amber-300 bg-amber-50"><p className="text-sm font-semibold">Filter changes not applied. Results, pages and downloads still use the applied filters below.</p><button type="button" className="btn-secondary mt-2" onClick={restoreApplied}>Restore applied filters</button></div>}
   {error && <div role="alert" className="panel p-4 mb-5"><p className="form-error">{error}</p><div className="flex flex-wrap gap-2 mt-2"><button type="button" className="btn-secondary" onClick={() => { if (lastRequest.current) void load(lastRequest.current.page, lastRequest.current.query); }}>Retry same report</button>{selected === "ageing" && <><button type="button" className="btn-secondary" onClick={() => { const today = indiaDay(); setFrom(today); setTo(today); void load(1, reportFilterQuery({ report: selected, from: today, to: today, customerId, supplierId, ownerId, status })); }}>Use today&apos;s balance</button>{customerId && <button type="button" className="btn-secondary" onClick={() => { choose("statement"); const dates = reportDatePreset("month", "statement", options?.cutover || null); if (dates) { setFrom(dates.from); setTo(dates.to); } }}>Open customer statement</button>}</>}</div></div>}
   {busy && <p role="status" className="panel p-5">Loading report…</p>}
   {!data && !busy && !error && <EmptyState icon="dashboard" title="Choose your report filters" description="No report generated yet. Generate a report to inspect transactions, balances and export options." />}
   {data && <>
    <p role="status" className="sr-only">{data.title} ready. {data.totalRows} matching records. Page {data.page} of {data.pages}.</p>
    <section className="panel p-5 mb-5 report-applied-panel" aria-label="Applied report filters">
     <div className="flex flex-wrap justify-between items-start gap-3"><div><h2 className="text-lg font-semibold">{data.party?.name || data.title}</h2><p className="text-sm text-slate-600 mt-1">{data.description}</p></div>{canExport && <div className="flex flex-wrap gap-2">{["csv", "xlsx", ...(statement ? ["pdf"] : [])].map(format => <a key={format} className="btn-secondary" href={`/api/reports/accounts?${applied}&format=${format}`}>Download {format.toUpperCase()}</a>)}</div>}</div>
     <p className="report-applied-line">{balance?`As of ${data.period.to}`:`${data.period.from} – ${data.period.to}`} · {data.metadata.account} · {data.metadata.currency} · {data.metadata.scope}</p>
     <details className="report-criteria"><summary>Applied criteria & date basis</summary><dl className="report-applied mt-4"><div><dt>Applied dates</dt><dd>{balance ? `As of ${data.period.to}` : `${data.period.from}–${data.period.to}`} · India calendar</dd></div><div><dt>Date basis</dt><dd>{data.metadata.dateBasis}</dd></div><div><dt>Accounts</dt><dd>{data.metadata.account}</dd></div><div><dt>Currency & scope</dt><dd>{data.metadata.currency} · {data.metadata.scope}</dd></div>{data.metadata.filters.filter(f => !["Customer", "Supplier"].includes(f.label)).map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.displayValue || f.value}</dd></div>)}</dl></details>
     <p className="text-xs text-slate-600 mt-4">Generated {new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · {data.totalRows} movements / records. Downloads rerun these applied filters against the latest records and include every matching row.</p>
     {chosen?.cutoff && cutoff && <p className="text-sm mt-3"><strong>Balance coverage:</strong> preserved from {cutoff}; older activity is included in the opening position, not reconstructed transaction history.</p>}
     {selected === "ageing" && <p className="text-sm mt-3"><strong>Historical coverage:</strong> past dates require verifiable receipt allocation history. If unavailable, use today&apos;s balance or a customer statement; an unsupported historical total must not be guessed.</p>}
     {selected === "sales" && <p className="text-sm mt-3"><strong>Margin coverage:</strong> known-cost confirmed bookings only. Uncosted bookings and visa service costs are excluded; this is not net profit.</p>}
     {statement && <p className="text-sm mt-3"><strong>Statement scope:</strong> operational obligations and money movements, not a statutory tax invoice or general ledger. Pending customer refunds are current workflow amounts, separate from period cash.</p>}
     <div className="mt-3 flex flex-wrap items-center gap-3 no-print"><button type="button" className="report-link-action" onClick={async()=>{try{await navigator.clipboard.writeText(`${window.location.origin}/reports?${applied}`);setLinkNotice("Report filter link copied. Access still follows each signed-in user's permissions.");}catch{setLinkNotice("Copy the report URL from your browser to reuse these filters.");}}}>Copy report filter link</button><button type="button" className="report-link-action" onClick={()=>window.print()}>Print report</button></div>{linkNotice&&<p role="status" className="mt-2 text-sm text-slate-600">{linkNotice}</p>}
    </section>
    <div className="report-summary mb-5">{data.summary.map(s => <section className="panel p-4" key={s.label}><h3 className="text-sm text-slate-600">{s.label}</h3><p className="mt-2 text-xl font-semibold tabular-nums">{s.money ? inrAmount(s.value) : s.value}</p></section>)}</div>
    {selected === "ageing" && canTerms && editableTermsRows.length > 0 && <button type="button" className="btn-secondary mb-4" onClick={() => setTerms(true)}>Set payment terms</button>}
    <section className="panel overflow-hidden" aria-label="Report records">
     <div className="report-table-scroll hidden md:block" role="region" aria-label={`${data.title} details`} tabIndex={0}><table aria-label={data.title}><thead><tr>{data.columns.map(c => <th key={c.key} scope="col" className={c.money ? "text-right" : ""}>{c.label}</th>)}</tr></thead><tbody>{data.rows.map((row, i) => <tr key={`${data.page}-${i}`}>{data.columns.map(c => <td key={c.key} className={c.money ? "text-right tabular-nums" : ""}><ReportCell row={row} column={c} /></td>)}</tr>)}</tbody></table></div>
     <MobileRecords data={data} />
     {!data.rows.length && <p className="p-5 text-sm text-slate-600">No matching records for the applied filters.{statement ? " The opening balance is carried forward." : " Try a wider permitted range or clear a filter."}</p>}
     <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-t"><p className="text-xs text-slate-600">Page {data.page} of {data.pages} · 50 rows per page · exports include all matching rows</p><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={data.page <= 1} onClick={() => void load(data.page - 1, applied)}>Previous</button><button type="button" className="btn-secondary" disabled={data.page >= data.pages} onClick={() => void load(data.page + 1, applied)}>Next</button></div></div>
    </section>
    <details className="panel mt-5 p-5"><summary className="cursor-pointer text-sm font-semibold">Report definitions and coverage</summary><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">{data.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
    {appliedCustomer && !supplier && <Link className="btn-secondary mt-4" href={`/customers/${appliedCustomer}`}>Open customer workspace</Link>}
   </>}
   {terms && data && editableTermsRows.length > 0 && <PaymentTerms rows={editableTermsRows} onClose={() => setTerms(false)} onSaved={() => { setTerms(false); void load(1, applied); }} />}
  </>}
 </div>;
}
function ReportCell({ row, column }: { row: ReportRow; column: AccountReport["columns"][number] }) {
 if (row[column.key] === null) return <>Not recorded</>;
 if (column.money) return <>{inrAmount(Number(row[column.key]))}</>;
 const value = String(row[column.key] ?? "—");
 const href = column.key === "reference" ? row._href : column.key === "customer" ? row._customerHref : null;
 return href ? <Link className="text-blue-700 underline" href={String(href)}>{value}</Link> : <>{value}</>;
}
function MobileRecords({ data }: { data: AccountReport }) {
 const reference = data.columns.find(c => c.key === "reference");
 const primary = data.columns.filter(c => ["date", "customer", "status", "service", "outstanding", "balance"].includes(c.key));
 const remaining = data.columns.filter(c => c !== reference && !primary.includes(c));
 return <ul className="md:hidden divide-y" aria-label="Report record cards">{data.rows.map((row, i) => <li className="p-4" key={`${data.page}-${i}`}>
  <h3 className="font-semibold mb-3">{reference ? <ReportCell row={row} column={reference} /> : `Record ${(data.page - 1) * 50 + i + 1}`}</h3>
  <dl className="report-mobile-values">{primary.map(c => <div key={c.key}><dt>{c.label}</dt><dd><ReportCell row={row} column={c} /></dd></div>)}</dl>
  {remaining.length > 0 && <details className="mt-3"><summary className="text-sm font-semibold cursor-pointer py-2">All record details</summary><dl className="report-mobile-values mt-2">{remaining.map(c => <div key={c.key}><dt>{c.label}</dt><dd><ReportCell row={row} column={c} /></dd></div>)}</dl></details>}
 </li>)}</ul>;
}
function PaymentTerms({rows,onClose,onSaved}:{rows:AccountReport["rows"];onClose:()=>void;onSaved:()=>void}){
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [selected,setSelected]=useState("0"),[dueDate,setDue]=useState(/^\d{4}-\d{2}-\d{2}$/.test(String(rows[0]?.due))?String(rows[0].due):""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");const row=rows[Number(selected)];try{const r=await fetch("/api/reports/terms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:row._type,id:row._id,dueDate:dueDate||null})});const d=await r.json();if(!mounted.current)return;if(!r.ok)throw new Error(d.error||"Could not save terms.");onSaved();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Connection failed.");}finally{if(mounted.current)setBusy(false);}}
 return <Modal label="Payment terms" onClose={onClose} busy={busy}><form className="space-y-5" onSubmit={save}><h2 className="text-xl font-semibold">Set payment terms</h2><p className="text-sm text-slate-500">Choose an editable obligation from this report page. Platform-managed booking terms are excluded. The date applies from this change onward; past ageing stays preserved. Leave the date empty to clear it.</p><Field label="Obligation"><select disabled={busy} value={selected} onChange={e=>{setSelected(e.target.value);const due=String(rows[Number(e.target.value)]?.due);setDue(/^\d{4}-\d{2}-\d{2}$/.test(due)?due:"");}}>{rows.map((r,i)=><option key={String(r._id)} value={String(i)}>{r.customer} · {r.reference} · {r.due}</option>)}</select></Field><Field label="Payment due date"><input type="date" disabled={busy} value={dueDate} onChange={e=>setDue(e.target.value)}/></Field>{error&&<p role="alert" className="form-error">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy?"Saving…":"Save payment terms"}</button></div></form></Modal>;
}
