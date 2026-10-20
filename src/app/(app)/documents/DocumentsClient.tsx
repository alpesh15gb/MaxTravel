"use client";
import { AuditTrailLink } from "@/components/AuditTrailLink";

import { enumLabel } from "@/lib/labels";
import { dateLabel } from "@/lib/dates";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, SearchInput, Status } from "@/components/ui";
import { openSignedFile } from "@/lib/openSignedFile";
import ActionDialog from "@/components/ActionDialog";
import { useToast } from "@/lib/useToast";

type Doc = {
  id: string; docNo: string; docType: string; status: string;
  customer: string; customerId: string; customerCode: string;
  traveller: string | null; visaCase: string | null; visaCaseId: string | null;
  uploadedAt: string | null; uploadSource: string | null;
  verificationStatus: string; verifiedBy: string | null; expiryDate: string | null;
  rejectionReason: string | null; hasFile: boolean; version: number;
  warnings: { type: string; message: string }[];
};

const TABS = [
  ["ALL", "All"], ["PENDING_VERIFICATION", "Verification queue"], ["REUPLOAD_REQUESTED", "Re-upload requested"],
  ["EXPIRING", "Expiring / expired"], ["SUBMITTED", "Submitted"], ["ARCHIVED", "Archived"],
] as const;

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const STATUS_TONE: Record<string, Tone> = {
  REQUIRED: "neutral",
  REQUESTED: "info",
  RECEIVED: "info",
  UNDER_REVIEW: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  REUPLOAD_REQUESTED: "danger",
  SUBMITTED: "info",
  ARCHIVED: "neutral",
};

export default function DocumentsClient({ documents, focus, perms, canExport, canAudit }: { documents: Doc[]; focus: string | null; perms: { verify: boolean; upload: boolean }; canExport?: boolean; canAudit: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<string>(focus ? "ALL" : "PENDING_VERIFICATION");
  const [q, setQ] = useState("");
  const { show, toast } = useToast();

  const [rejectTarget, setRejectTarget] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    if (focus) document.getElementById(`document-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);
  const now = Date.now();
  // What the desk actually has to do: rows sitting in the verification queue. The count is on the
  // button so the primary action says how much work is behind it before it is pressed.
  const pendingCount = documents.filter((d) => ["RECEIVED", "UNDER_REVIEW"].includes(d.status)).length;
  const filtered = useMemo(() => {
    const n = q.toLowerCase();
    return documents.filter((d) => {
      if (n && ![d.docType, d.docNo, d.customer, d.traveller ?? "", d.visaCase ?? ""].some((v) => v.toLowerCase().includes(n))) return false;
      switch (tab) {
        case "PENDING_VERIFICATION":
          return ["RECEIVED", "UNDER_REVIEW"].includes(d.status);
        case "REUPLOAD_REQUESTED": return ["REJECTED", "REUPLOAD_REQUESTED"].includes(d.status);
        case "EXPIRING":
          return d.expiryDate && new Date(d.expiryDate).getTime() - now < 180 * 86400000;
        case "SUBMITTED": return d.status === "SUBMITTED";
        case "ARCHIVED": return d.status === "ARCHIVED";
        default: return true;
      }
    });
  }, [documents, tab, q, now]);

  async function verify(id: string, decision: "ACCEPTED" | "REJECTED", reason?: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setReviewError("");
    try {
      const r = await fetch("/api/documents/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id, decision, reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not save the decision. Try again.");
      show(decision === "ACCEPTED" ? "Document accepted" : "Document rejected. No message was sent — contact the customer to request a replacement.");
      setRejectTarget(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed. Please retry.";
      if (decision === "REJECTED") setReviewError(message);
      else show(message, "error");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  async function view(d: Doc) {
    const problem = await openSignedFile(
      () => fetch(`/api/documents/${d.id}/file`, { method: "POST" }),
      "Could not open this file. Ask an administrator to check document storage.",
    );
    if (problem) show(problem, "error");
  }

  return (
    <div className="workspace-page">
      {/* One primary action: work the verification queue. It steps back when there is nothing on the
          desk at all, because then the empty state's destination is the thing to do. */}
      <PageHeader title="Document desk" description="Document requirements and uploaded files for each traveller. Up to 400 recent records in your scope."
        actions={<>{canExport && <a className="btn-secondary" href="/api/export?entity=documents">Export</a>}<button type="button" className={documents.length ? "btn-primary" : "btn-secondary"} onClick={() => setTab("PENDING_VERIFICATION")}>Review verification queue{pendingCount ? ` (${pendingCount})` : ""}</button></>} />

      <div className="panel mb-5 flex flex-wrap items-center gap-3 p-3">
        <div className="segmented overflow-x-auto" role="group" aria-label="Document views">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <SearchInput label="Filter documents" placeholder="Filter documents…" value={q} onChange={setQ} className="ml-auto" />
      </div>

      <div className="space-y-2">
        {filtered.map((d) => (
          <div key={d.id} id={`document-${d.id}`} className={`panel flex flex-wrap items-center gap-3 px-4 py-4 ${focus === d.id ? "ring-2 ring-teal-500" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                <span className="font-semibold">{d.docType}</span>
                <span className="text-xs text-slate-500"> · {d.docNo} · v{d.version}{d.traveller ? ` · ${d.traveller}` : ""}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                <Link href={`/customers/${d.customerId}`} className="font-medium text-slate-700 hover:text-teal-700">{d.customer}</Link>
                {d.visaCaseId && <> · <Link href={`/visa/${d.visaCaseId}`} className="hover:text-teal-700">{d.visaCase}</Link></>}
                {d.uploadedAt ? ` · ${d.uploadSource ?? "staff"} ${dateLabel(d.uploadedAt)}` : " · not uploaded"}
                {d.verifiedBy ? ` · verified by ${d.verifiedBy}` : ""}
                {d.expiryDate ? ` · expires ${dateLabel(d.expiryDate)}` : ""}
              </div>
              {d.warnings?.map((w, i) => <div key={i} className="mt-1 text-xs text-amber-700">⚠ {w.message}</div>)}
              {d.rejectionReason && <div className="mt-1 text-xs text-rose-700">✗ {d.rejectionReason}</div>}
            </div>
            <Status tone={STATUS_TONE[d.status] ?? "neutral"}>{enumLabel(d.status)}</Status>
            <div className="flex flex-wrap shrink-0 gap-2">
              <AuditTrailLink entity="Document" entityId={d.id} allowed={canAudit} compact />
              {d.hasFile && (
                <button onClick={() => view(d)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">View</button>
              )}
              {perms.verify && ["RECEIVED", "UNDER_REVIEW"].includes(d.status) && (
                <>
                  {/* A row action beside a row action: the screen's primary is the queue above, so
                      accepting one document is a secondary step, not a second primary. */}
                  <button disabled={busy || !d.hasFile} onClick={() => verify(d.id, "ACCEPTED")} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Accept</button>
                  <button disabled={busy || !d.hasFile} onClick={() => { setReviewError(""); setRejectTarget(d); }} className="btn-secondary min-h-8 px-3 py-1.5 text-xs text-rose-700">Reject</button>
                </>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <EmptyState icon="documents" title={documents.length ? "No documents in this view" : "No document requirements yet"} description={documents.length ? "Choose another document status or search term." : "Attach a destination checklist to a visa case, then share a private upload link from the customer workspace."} href={!documents.length ? "/visa" : undefined} action={!documents.length ? "Go to visa cases" : undefined} />}
      </div>

      {rejectTarget && <ActionDialog title={`Reject ${rejectTarget.docType}?`} description="Explain exactly what needs replacing. This saves the rejection reason; it does not send a message or upload link to the customer." fieldLabel="Reason for rejection" fieldType="textarea" fieldPlaceholder="For example: passport photo is blurred; please upload a clear full-page scan." required confirmLabel="Reject document" tone="danger" busy={busy} error={reviewError} onClose={() => { if (!busy) setRejectTarget(null); }} onConfirm={reason => void verify(rejectTarget.id, "REJECTED", reason)} />}
      {toast}
    </div>
  );
}
