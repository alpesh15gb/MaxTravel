"use client";

import { dateTimeLabel } from "@/lib/dates";
import Link from "next/link";
import type { AuditFilters } from "@/lib/audit-query";
import { PageHeader, Field } from "@/components/ui";

type L = { id: string; action: string; entity: string; entityId: string | null; detail: string | null; user: string; at: string };

const ACTION_COLOR: Record<string, string> = {
  CREATE: "bg-teal-50 text-teal-700 border-teal-200",
  EDIT: "bg-sky-50 text-sky-700 border-sky-200",
  STATUS: "bg-indigo-50 text-indigo-700 border-indigo-200",
  STAGE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  VERIFY: "bg-amber-50 text-amber-700 border-amber-200",
  RECORD: "bg-teal-50 text-teal-700 border-teal-200",
  SEND: "bg-teal-50 text-teal-700 border-teal-200",
  EXPORT: "bg-orange-50 text-orange-700 border-orange-200",
  CHANGE_PASSWORD: "bg-rose-50 text-rose-700 border-rose-200",
};

const detailLabel = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, first => first.toUpperCase());
const primitiveLabel = (value: unknown): string | null => {
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
};

function AuditDetail({ detail }: { detail: string | null }) {
  if (!detail) return <>—</>;
  let parsed: unknown;
  try { parsed = JSON.parse(detail); } catch { return <>{detail}</>; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return <>{detail}</>;
  const summary: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "fields" && Array.isArray(value) && value.every(field => typeof field === "string")) {
      summary.push(`Changed fields: ${value.map(detailLabel).join(", ") || "None"}`);
    } else if (value && typeof value === "object" && !Array.isArray(value) && "from" in value && "to" in value) {
      const from = primitiveLabel(value.from), to = primitiveLabel(value.to);
      if (from !== null && to !== null) summary.push(`${detailLabel(key)}: ${from} → ${to}`);
    } else {
      const label = primitiveLabel(value);
      if (label !== null) summary.push(`${detailLabel(key)}: ${label}`);
    }
  }
  return <div>
    {summary.length ? <ul className="space-y-1">{summary.map((line, index) => <li key={index}>{line}</li>)}</ul> : <span>Structured change recorded</span>}
    <details className="mt-2"><summary className="min-h-8 cursor-pointer py-1 text-slate-600 underline">View original detail</summary><pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{detail}</pre></details>
  </div>;
}

export default function AuditClient({ logs, total, page, pageSize, canExport, filters, restricted }: { filters: AuditFilters; restricted: boolean; logs: L[]; total: number; page: number; pageSize: number; canExport?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const query = new URLSearchParams(filters);
  const pageHref = (n: number) => `/audit?${new URLSearchParams({...filters,page:String(n)})}`;
  return (
    <div className="workspace-page">
      {/* Filtering is the primary action; export preserves the active filters. */}
      <PageHeader title="Audit trail" description={`${total} recorded actions · page ${page} of ${pages}. A record of who changed what.`}
        actions={canExport ? <a className="btn-secondary" href={`/api/export?entity=audit&${query}`}>Export audit trail</a> : undefined} />

      <form key={query.toString()} action="/audit" className="panel p-4 grid gap-3 sm:grid-cols-3 mb-4">
        {([['actor','Employee name, code or ID (system for external)'],['action','Action (e.g. CREATE, STAGE)'],['recordType','Record type (e.g. Booking, VisaCase)'],['entityId','Exact record ID'],['from','From date (IST)'],['to','To date (IST)']] as const).map(([key,label]) => <Field label={label} key={key}><input name={key} type={key==='from'||key==='to'?'date':'text'} defaultValue={filters[key] ?? ''} maxLength={160}/></Field>)}
        <div className="flex gap-2"><button className="btn-primary" type="submit">Apply filters</button><Link className="btn-secondary" href="/audit">Clear</Link></div>
        <p className="text-xs text-slate-500 sm:col-span-3">{restricted ? 'History is limited to currently accessible records. Deleted records and global configuration events are available only to all-workspace administrators.' : 'Includes system and employee actions. Older entries may not contain field-level changes.'} CSV uses these filters (up to 5,000 entries).</p>
      </form>
      <div className="panel overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="bg-white text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">When (IST)</th>
              <th className="text-left px-3 py-2 font-medium">User</th>
              <th className="text-left px-3 py-2 font-medium">Action</th>
              <th className="text-left px-3 py-2 font-medium">Entity</th>
              <th className="text-left px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-slate-200">
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{dateTimeLabel(l.at)}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{l.user}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded border font-mono ${ACTION_COLOR[l.action] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}>{l.action}</span>
                </td>
                <td className="px-3 py-2 text-slate-500 font-mono">{l.entity}{l.entityId && <><br/><Link className="underline break-all" href={`/audit?${new URLSearchParams({recordType:l.entity,entityId:l.entityId})}`}>{l.entityId}</Link></>}</td>
                <td className="px-3 py-2 text-slate-500 max-w-80 whitespace-pre-wrap break-words"><AuditDetail detail={l.detail} /></td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No audit entries.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-3 text-xs">
        {page > 1 && <Link href={pageHref(page - 1)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">← Newer</Link>}
        {page < pages && <Link href={pageHref(page + 1)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Older →</Link>}
      </div>
    </div>
  );
}
