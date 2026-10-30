"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { BoardCard, BoardColumn, DocumentMeter } from "@/components/Board";
import { EmptyState, Status, ViewToggle, avatarClass, initialsOf } from "@/components/ui";

export interface PipelineCase {
  id: string; caseNo: string; serviceCaseNo?:string|null; customerId: string; customerName: string; phone: string; email: string | null;
  travellers: string[]; destination: string; visaType: string;
  stageId: string; stageKey: string; stageName: string; stageSeq: number;
  createdAt: string; createdLabel: string; travelDate: string | null; travelLabel: string | null; travelInDays: number | null;
  ownerName: string; docsTotal: number; docsReady: number;
  balance: number | null; balanceLabel: string | null;
}
export interface PipelineStage { id: string; key: string; name: string; seq: number }
export interface PipelinePerms { canMove: boolean; canApprove: boolean; canFinance: boolean; canExport: boolean; canCreate: boolean }

// Board columns group the workflow into the four stages a visa desk actually works through. Custom
// stages inherit the column of the nearest preceding standard stage, and closed cases stay in the
// decision column.
const COLUMNS = [
  { id: "enquiry", title: "Enquiry & assessment", dot: "bg-sky-500", keys: ["ENQUIRY", "ASSESSMENT", "PAYMENT_AWAITED"] },
  { id: "documents", title: "Documents", dot: "bg-amber-500", keys: ["DOCUMENTS_PENDING", "DOCUMENTS_VERIFICATION", "READY_FOR_SUBMISSION"] },
  { id: "submission", title: "Appointment & submission", dot: "bg-violet-500", keys: ["APPOINTMENT_REQUIRED", "APPOINTMENT_BOOKED", "SUBMITTED", "BIOMETRICS", "UNDER_PROCESS"] },
  { id: "decision", title: "Decision & delivery", dot: "bg-emerald-500", keys: ["APPROVED", "REJECTED", "PASSPORT_RECEIVED", "DELIVERED", "CLOSED"] },
];
// Decisions are recorded from the case page's stage menu (gated by visa:approve), never by a drag or
// the card's advance button.
const DROP_BLOCKED = new Set(["decision"]);
// Cases that have left the workflow carry no travel countdown and no document chase.
const FINISHED = new Set(["REJECTED", "CLOSED", "DELIVERED"]);

function columnOf(stage: { key: string; seq: number }, stages: PipelineStage[]): string {
  const direct = COLUMNS.find(c => c.keys.includes(stage.key));
  if (direct) return direct.id;
  const prior = stages.filter(s => s.seq < stage.seq).sort((a, b) => b.seq - a.seq)[0];
  return prior ? columnOf(prior, stages) : COLUMNS[0].id;
}
function columnForCase(c: PipelineCase, stages: PipelineStage[]): string {
  return columnOf({ key: c.stageKey, seq: c.stageSeq }, stages);
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
const DEADLINE_TONE: Record<Tone, string> = {
  neutral: "text-slate-600", success: "text-emerald-800", info: "text-sky-800", warning: "text-amber-800", danger: "text-rose-700",
};

/** The outcome chip, when the case has reached one. Documents and travel timing have their own lines. */
function outcomeFor(c: PipelineCase): { label: string; tone: Tone } | null {
  if (c.stageKey === "REJECTED") return { label: "Refused", tone: "danger" };
  if (c.stageKey === "APPROVED") return { label: "Approved", tone: "success" };
  if (c.stageKey === "CLOSED" || c.stageKey === "DELIVERED") return { label: "Completed", tone: "neutral" };
  return null;
}

/** The travel countdown a desk works to. The words carry the meaning; colour only reinforces them. */
function deadlineFor(c: PipelineCase): { text: string; tone: Tone } | null {
  if (!c.travelLabel || c.travelInDays === null || FINISHED.has(c.stageKey)) return null;
  const days = c.travelInDays;
  if (days < 0) return { text: `Travel date passed · ${c.travelLabel}`, tone: "danger" };
  if (days === 0) return { text: `Travels today · ${c.travelLabel}`, tone: "warning" };
  if (days <= 7) return { text: `Travels in ${days} day${days === 1 ? "" : "s"} · ${c.travelLabel}`, tone: "warning" };
  if (days <= 14) return { text: `Travels in ${days} days · ${c.travelLabel}`, tone: "info" };
  return { text: `Travel ${c.travelLabel}`, tone: "neutral" };
}

/** Open work whose required documents are not all verified yet. */
const needsDocs = (c: PipelineCase, column: string) => column !== "decision" && (c.docsTotal === 0 || c.docsReady < c.docsTotal);

type Quick = "" | "docs" | "travel" | "balance";
const QUICK_FILTERS: { id: Exclude<Quick, "">; label: string; financeOnly?: boolean; test: (c: PipelineCase, column: string) => boolean }[] = [
  { id: "docs", label: "Needs documents", test: (c, column) => needsDocs(c, column) },
  { id: "travel", label: "Travel within 14 days", test: c => !FINISHED.has(c.stageKey) && c.travelInDays !== null && c.travelInDays >= 0 && c.travelInDays <= 14 },
  { id: "balance", label: "Balance due", financeOnly: true, test: c => c.balance !== null && c.balance > 0 },
];

// Columns and list rows render in pages so a large case book stays fast and each column scrolls on its own.
const PAGE = 40;

export default function VisaPipeline({ cases, stages, perms, initialQuery, initialStage }: {
  cases: PipelineCase[]; stages: PipelineStage[]; perms: PipelinePerms; initialQuery: string; initialStage: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(cases);
  useEffect(() => setItems(cases), [cases]);
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState(initialQuery);
  const [stageFilter, setStageFilter] = useState(initialStage);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [quick, setQuick] = useState<Quick>("");
  const [sort, setSort] = useState<"newest" | "travel" | "balance" | "name">("newest");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  const [listShown, setListShown] = useState(PAGE);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // A new search, filter or sort starts every column and the list back at the first page.
  useEffect(() => { setShown({}); setListShown(PAGE); }, [query, stageFilter, ownerFilter, sort, quick]);

  const owners = useMemo(() => Array.from(new Set(items.map(c => c.ownerName))).sort(), [items]);
  const orderedStages = useMemo(() => stages.slice().sort((a, b) => a.seq - b.seq), [stages]);
  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach(c => counts.set(c.stageKey, (counts.get(c.stageKey) ?? 0) + 1));
    return counts;
  }, [items]);

  // Stage, owner and search narrow the book first; a quick filter then narrows that scope, so each
  // quick-filter count is the number you would see by selecting it.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(c =>
      (!stageFilter || c.stageKey === stageFilter) &&
      (!ownerFilter || c.ownerName === ownerFilter) &&
      (!q || `${c.caseNo}{c.serviceCaseNo&&<span className="block text-xs text-slate-600 mt-1">{c.serviceCaseNo}</span>} ${c.customerName} ${c.destination} ${c.travellers.join(" ")}`.toLowerCase().includes(q)));
  }, [items, query, stageFilter, ownerFilter]);

  const activeQuick = QUICK_FILTERS.find(f => f.id === quick);
  const visible = useMemo(() => {
    const list = activeQuick ? scoped.filter(c => activeQuick.test(c, columnForCase(c, stages))) : scoped;
    return [...list].sort((a, b) => {
      if (sort === "travel") return (a.travelDate ?? "9999") < (b.travelDate ?? "9999") ? -1 : (a.travelDate ?? "9999") > (b.travelDate ?? "9999") ? 1 : 0;
      if (sort === "balance") return (b.balance ?? 0) - (a.balance ?? 0);
      if (sort === "name") return a.customerName.localeCompare(b.customerName);
      return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0;
    });
  }, [scoped, activeQuick, sort, stages]);

  const firstStageOf = (columnId: string) => stages.find(s => columnOf(s, stages) === columnId);
  const canDropOn = (columnId: string) => perms.canMove && !DROP_BLOCKED.has(columnId) && !!firstStageOf(columnId);

  /** The one stage a card may advance to. Decisions are never offered from a card. */
  function advanceTarget(c: PipelineCase): PipelineStage | undefined {
    if (!perms.canMove) return undefined;
    const here = orderedStages.findIndex(s => s.id === c.stageId);
    const next = here >= 0 ? orderedStages[here + 1] : undefined;
    return next && !DROP_BLOCKED.has(columnOf(next, stages)) ? next : undefined;
  }

  async function moveCase(c: PipelineCase, stage: PipelineStage) {
    if (stage.id === c.stageId || busyId) return;
    const previous = items;
    setBusyId(c.id); setNotice(null);
    setItems(curr => curr.map(x => x.id === c.id ? { ...x, stageId: stage.id, stageKey: stage.key, stageName: stage.name, stageSeq: stage.seq } : x));
    try {
      const r = await fetch(`/api/visa/cases/${c.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageId: stage.id }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setItems(previous);
        setNotice({ tone: "error", text: d?.error ?? `${c.caseNo}{c.serviceCaseNo&&<span className="block text-xs text-slate-600 mt-1">{c.serviceCaseNo}</span>} could not be moved.` });
        return;
      }
      setNotice({ tone: "ok", text: `${c.caseNo}{c.serviceCaseNo&&<span className="block text-xs text-slate-600 mt-1">{c.serviceCaseNo}</span>} moved to ${stage.name}.` });
      router.refresh();
    } catch {
      setItems(previous);
      setNotice({ tone: "error", text: `Connection failed. ${c.caseNo}{c.serviceCaseNo&&<span className="block text-xs text-slate-600 mt-1">{c.serviceCaseNo}</span>} was not moved.` });
    } finally {
      setBusyId(null);
    }
  }

  function renderCard(c: PipelineCase) {
    const busy = busyId === c.id;
    const nextStage = advanceTarget(c);
    const outcome = outcomeFor(c);
    const deadline = deadlineFor(c);
    return <BoardCard key={c.id} busy={busy} dragging={dragId === c.id}
      draggable={perms.canMove && !busyId}
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); setDragId(c.id); }}
      onDragEnd={() => { setDragId(null); setOverColumn(null); }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-small font-semibold text-slate-500">{c.caseNo}{c.serviceCaseNo&&<span className="block text-xs text-slate-600 mt-1">{c.serviceCaseNo}</span>}</span><Status tone={outcome?.tone ?? "info"}>{c.stageName}</Status></div>
      <div className="flex items-start gap-3">
        <span className={`avatar ${avatarClass(c.customerName)}`} aria-hidden="true">{initialsOf(c.customerName)}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/visa/${c.id}`} className="board-card-title">{c.customerName}</Link>
          <p className="board-card-meta">{c.destination} · {c.visaType}</p>
        </div>
      </div>
      {(outcome || deadline) && <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {outcome && <Status tone={outcome.tone}>{outcome.label}</Status>}
        {deadline && <span className={`text-small font-medium ${DEADLINE_TONE[deadline.tone]}`}>{deadline.text}</span>}
      </div>}
      <div className="mt-3"><DocumentMeter ready={c.docsReady} total={c.docsTotal} /></div>
      <p className="mt-2.5 text-small text-slate-600">{c.travellers.join(", ") || "No applicants"}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-small text-slate-500">
        <span className="min-w-0">Owner {c.ownerName}</span>
        {c.balanceLabel && <span className="shrink-0 font-semibold text-amber-800">Due {c.balanceLabel}</span>}
      </div>
      {nextStage && <button type="button" className="btn-secondary mt-3 w-full" disabled={busyId !== null} onClick={() => moveCase(c, nextStage)}>
        <Icon name="arrow" size={15} />{busy ? "Moving…" : `Move to ${nextStage.name}`}
      </button>}
      <Link href={`/visa/${c.id}`} className="board-open-link">Open case & documents<Icon name="arrow" size={14}/></Link>
    </BoardCard>;
  }

  return <div>
    <div className="workspace-toolbar">
      <ViewToggle label="Pipeline view" value={view} onChange={setView} options={[{ value: "board", label: "Board", icon: "board" }, { value: "list", label: "List", icon: "list" }]} />
      <select aria-label="Filter by stage" className="control max-w-[220px]" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
        <option value="">All stages</option>
        {stages.map(s => <option key={s.key} value={s.key}>{s.name} ({stageCounts.get(s.key) ?? 0})</option>)}
      </select>
      <select aria-label="Filter by owner" className="control max-w-[200px]" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
        <option value="">All owners</option>
        {owners.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <div className="relative min-w-[220px] flex-1 md:max-w-sm">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={16} /></span>
        <input type="search" aria-label="Search visa cases" className="control w-full pl-9" placeholder="Search case, customer, applicant…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <label className="ml-auto flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon name="sort" size={15} />Sort by
        <select aria-label="Sort cases" className="control" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest first</option>
          <option value="travel">Travel date (soonest)</option>
          {perms.canFinance && <option value="balance">Balance due (highest)</option>}
          <option value="name">Customer A–Z</option>
        </select>
      </label>
    </div>

    <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Quick filters">
      <button type="button" className="chip-filter" aria-pressed={quick === ""} onClick={() => setQuick("")}>All ({scoped.length})</button>
      {QUICK_FILTERS.filter(f => !f.financeOnly || perms.canFinance).map(f => (
        <button key={f.id} type="button" className="chip-filter" aria-pressed={quick === f.id}
          onClick={() => setQuick(quick === f.id ? "" : f.id)}>
          {f.label} ({scoped.filter(c => f.test(c, columnForCase(c, stages))).length})
        </button>
      ))}
    </div>

    <p className="mb-3 text-xs text-slate-600">Showing {visible.length} of {items.length} cases{view === "list" ? " · Open a case to review or update it." : " · Each card shows its current stage and next step."}</p>
    {view === "board" && visible.length > 0 && <div className="board-guide"><div><strong>Your visa workflow</strong><p>Follow the four steps below. Use a card’s named action to advance one stage. Record approvals and refusals inside the case.</p></div><nav aria-label="Jump to workflow step" className="board-jumps">{COLUMNS.map((col,i)=><a key={col.id} href={`#visa-lane-${col.id}`}>{i+1}. {col.title}<span>{visible.filter(c=>columnForCase(c,stages)===col.id).length}</span></a>)}</nav></div>}
    <div role="status" aria-live="polite">{notice && <div className={`${notice.tone === "ok" ? "form-success" : "form-error"} mb-4`}>{notice.text}</div>}</div>

    {!visible.length && <EmptyState icon="visa" title="No cases match this view" description="Try a different search, stage, owner or quick filter." />}

    {view === "board" && visible.length > 0 && <div className="board-scroll workflow-board" aria-label="Visa cases by stage">
      {COLUMNS.map(col => {
        const all = visible.filter(c => columnForCase(c, stages) === col.id);
        const limit = shown[col.id] ?? PAGE;
        const cards = all.slice(0, limit);
        const remaining = all.length - limit;
        const droppable = canDropOn(col.id);
        const hovering = overColumn === col.id && dragId !== null;
        const descriptions:Record<string,string>={enquiry:"Confirm requirements and payment",documents:"Collect and verify the applicant’s files",submission:"Book appointments and track processing",decision:"Record the outcome and return the passport"};
        return <BoardColumn key={col.id} id={`visa-lane-${col.id}`} step={COLUMNS.indexOf(col)+1} title={col.title} description={dragId && droppable ? `Drop moves to ${firstStageOf(col.id)?.name}` : descriptions[col.id]} dot={col.dot} count={all.length} countLabel={`${all.length} cases`}
          empty={all.length === 0} drop={hovering ? (droppable ? "ok" : "blocked") : null}
          onDragOver={e => { if (dragId && droppable) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverColumn(col.id); } }}
          onDragLeave={() => { if (overColumn === col.id) setOverColumn(null); }}
          onDrop={e => {
            e.preventDefault();
            const c = items.find(x => x.id === dragId);
            const target = firstStageOf(col.id);
            setDragId(null); setOverColumn(null);
            if (c && target && droppable && c.stageId !== target.id) moveCase(c, target);
          }}>
          {cards.map(renderCard)}
          {all.length === 0 && <p className="board-empty">No matching cases at this step.</p>}
          {remaining > 0 && <button type="button" className="btn-secondary w-full" onClick={() => setShown({ ...shown, [col.id]: limit + PAGE })}>Show {Math.min(PAGE, remaining)} more · {remaining} left</button>}
        </BoardColumn>;
      })}
    </div>}

    {view === "list" && visible.length > 0 && <div className="panel overflow-x-auto">
      <table className="text-sm">
        <thead><tr>{["Case / Applicants", "Customer", "Destination", "Stage", "Documents", "Travel", "Owner", "Balance"].map(h => <th key={h} className="px-4">{h}</th>)}</tr></thead>
        <tbody>{visible.slice(0, listShown).map(c => {
          const column = columnForCase(c, stages);
          return <tr key={c.id} className="border-t">
            <td className="px-4"><Link className="text-xs font-semibold text-teal-700" href={`/visa/${c.id}`}>{c.caseNo}{c.serviceCaseNo&&<span className="block text-xs text-slate-600 mt-1">{c.serviceCaseNo}</span>}</Link><p className="mt-1 text-small text-slate-500">{c.travellers.join(", ")}</p></td>
            <td className="px-4"><Link className="text-xs hover:text-teal-700" href={`/customers/${c.customerId}`}>{c.customerName}</Link></td>
            <td className="px-4"><span className="text-xs font-medium">{c.destination}</span><p className="mt-1 text-small text-slate-500">{c.visaType}</p></td>
            <td className="px-4"><Status tone={c.stageKey === "APPROVED" ? "success" : c.stageKey === "REJECTED" ? "danger" : "neutral"}>{c.stageName}</Status></td>
            <td className="px-4 text-xs text-slate-600">{c.docsReady}/{c.docsTotal} verified{needsDocs(c, column) ? <p className="mt-1 text-small text-amber-700">{c.docsTotal === 0 ? "No documents requested" : "Needs documents"}</p> : null}</td>
            <td className="px-4 text-xs text-slate-500">{c.travelLabel ?? "Not set"}</td>
            <td className="px-4 text-xs text-slate-500">{c.ownerName}</td>
            <td className="px-4 text-xs font-semibold text-amber-800">{perms.canFinance ? (c.balanceLabel ?? "—") : "Restricted"}</td>
          </tr>;
        })}</tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-slate-500">
        <span>Showing {Math.min(listShown, visible.length)} of {visible.length} matching · {items.length} total</span>
        {visible.length > listShown && <button type="button" className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setListShown(listShown + PAGE)}>Show {Math.min(PAGE, visible.length - listShown)} more</button>}
      </div>
    </div>}
  </div>;
}
