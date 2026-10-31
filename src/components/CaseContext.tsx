"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
export default function CaseContext() {
  const path = usePathname(),
    q = useSearchParams(),
    id = path.split("/")[2],
    kind = path.split("/")[1],
    caseId = q.get("case"),
    [record, setRecord] = useState<{
      key: string;
      case: { id: string; caseNo: string; title: string; owner: string };
    } | null>(null),
    key = `${path}:${caseId}`;
  useEffect(() => {
    if (!["visa", "ticketing"].includes(kind) || !id) return;
    const c = new AbortController();
    fetch(
      `/api/work/context?kind=${kind}&id=${id}${caseId ? `&case=${encodeURIComponent(caseId)}` : ""}`,
      { signal: c.signal },
    )
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        if (d.case && !c.signal.aborted) setRecord({ key, case: d.case });
      })
      .catch(() => {});
    return () => c.abort();
  }, [key, kind, id, caseId]);
  const row = record?.key === key ? record.case : null;
  if (!row) return null;
  return (
    <div className="work-case-context">
      <div>
        <Link href={`/cases/${row.id}`}>{row.caseNo}</Link>
        <span>
          {row.title} · Coordinator: {row.owner}
        </span>
      </div>
      <Link href={`/cases/${row.id}?tab=work`}>Case work →</Link>
    </div>
  );
}
