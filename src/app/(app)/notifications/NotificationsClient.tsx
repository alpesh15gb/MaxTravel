"use client";

import { dateTimeLabel } from "@/lib/dates";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, Status } from "@/components/ui";

type N = { id: string; title: string; body: string | null; link: string | null; severity: string; read: boolean; createdAt: string };

const TONE: Record<string, "danger" | "warning" | "info"> = {
  URGENT: "danger",
  WARNING: "warning",
  INFO: "info",
};

export default function NotificationsClient({ notifications }: { notifications: N[] }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function markAllRead() {
    setBusy(true);setError("");
    try { const r=await fetch("/api/notifications",{method:"POST"}); if(!r.ok)throw new Error();window.dispatchEvent(new Event("notifications:changed"));router.refresh(); }
    catch { setError("Could not mark notifications read. Please try again."); }
    finally { setBusy(false); }
  }

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="workspace-page">
      <PageHeader title="Your notifications" description={unread ? `${unread} new · document receipts and operational updates addressed to you.` : "Document receipts and operational updates addressed to you."}
        actions={<><Link className="btn-primary" href="/dashboard">Open agency pulse</Link>{unread>0&&<button className="btn-secondary" disabled={busy} onClick={markAllRead}>{busy?"Saving…":"Mark all read"}</button>}</>} />
      {error && <div role="alert" className="form-error mb-4">{error}</div>}
      {notifications.length === 0
        ? <EmptyState icon="bell" title="You’re all caught up" description="Notifications will appear when your real operational records need a follow-up." />
        : <ul className="panel divide-y divide-slate-100 overflow-hidden">
          {notifications.map((n) => (
            <li key={n.id} className={`flex items-start gap-4 px-5 py-4 ${n.read ? "" : "bg-teal-50/40"}`}>
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-teal-600"}`} aria-label={n.read ? "Read" : "Unread"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Status tone={TONE[n.severity] ?? "info"}>{n.severity}</Status>
                  {n.link ? (
                    <Link href={n.link} className={`text-sm hover:text-teal-700 ${n.read ? "text-slate-600" : "font-semibold text-slate-900"}`}>{n.title}</Link>
                  ) : (
                    <span className={`text-sm ${n.read ? "text-slate-600" : "font-semibold text-slate-900"}`}>{n.title}</span>
                  )}
                </div>
                {n.body && <div className="mt-1 text-xs leading-5 text-slate-500">{n.body}</div>}
                <div className="mt-1 text-small text-slate-500">{dateTimeLabel(n.createdAt)}</div>
              </div>
            </li>
          ))}
        </ul>}
    </div>
  );
}
