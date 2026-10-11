"use client";

import { dateTimeLabel } from "@/lib/dates";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

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

export default function AuditClient({ logs, total, page, pageSize, canExport }: { logs: L[]; total: number; page: number; pageSize: number; canExport?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="workspace-page">
      {/* A read-only report screen still has one thing to do with it: take it somewhere it can be
          worked on. Export is that action, and it is the same CSV path the other modules use. */}
      <PageHeader title="Audit trail" description={`${total} recorded actions · page ${page} of ${pages}. A record of who changed what.`}
        actions={canExport ? <a className="btn-primary" href="/api/export?entity=audit">Export audit trail</a> : undefined} />

      <div className="panel overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="bg-white text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">When</th>
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
                <td className="px-3 py-2 text-slate-500 font-mono">{l.entity}{l.entityId ? ` · ${l.entityId.slice(-6)}` : ""}</td>
                <td className="px-3 py-2 text-slate-500 max-w-80 truncate">{l.detail ?? "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No audit entries.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-3 text-xs">
        {page > 1 && <Link href={`/audit?page=${page - 1}`} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">← Newer</Link>}
        {page < pages && <Link href={`/audit?page=${page + 1}`} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Older →</Link>}
      </div>
    </div>
  );
}
