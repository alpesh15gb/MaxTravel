import Link from "next/link";
import TripStageBar from "@/components/TripStageBar";
import Icon, { type IconName } from "@/components/Icon";
import { dateLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import type { TripRow, TripService } from "@/lib/trips-read";

export const SERVICE_ICON: Record<TripService["kind"], IconName> = { FLIGHT: "plane", HOTEL: "board", VISA: "visa", OTHER: "list", ENQUIRY: "compass" };
export const SERVICE_LABEL: Record<TripService["kind"], string> = { FLIGHT: "Flight", HOTEL: "Hotel", VISA: "Visa", OTHER: "Other service", ENQUIRY: "Enquiry" };

export default function TripsList({ rows }: { rows: TripRow[] }) {
  return <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
    {rows.map(r => {
      const kinds = [...new Set(r.services.filter(s => !s.dead).map(s => s.kind))];
      return <li key={r.id}>
        <Link href={`/trips/${r.id}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <strong className="text-sm text-slate-900">{r.customer.name}</strong>
              <span className="text-xs text-slate-500">Max ID {r.caseNo}</span>
              {r.online && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-micro font-semibold text-indigo-800">Online</span>}
            </span>
            <span className="mt-0.5 block truncate text-sm text-slate-600">{r.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {kinds.map(k => <span key={k} className="inline-flex items-center gap-1"><Icon name={SERVICE_ICON[k]} size={14} />{SERVICE_LABEL[k]}</span>)}
              {r.start && <span>· {dateLabel(r.start)}{r.end && r.end !== r.start ? ` – ${dateLabel(r.end)}` : ""}</span>}
              <span>· {r.owner}</span>
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <TripStageBar stage={r.stage} compact />
            {r.nextTodo && <span className={`truncate text-xs ${r.nextTodo.overdue ? "font-semibold text-rose-700" : "text-slate-600"}`}>{r.nextTodo.overdue ? "Overdue: " : "Next: "}{r.nextTodo.title}</span>}
          </span>
          {r.balanceMinor !== null && <span className="flex flex-col text-sm sm:items-end">{r.profit && r.stage !== "ENQUIRY" && r.stage !== "QUOTED" && <span className={`font-semibold ${r.profit.marginMinor === null ? "text-slate-500" : r.profit.marginMinor > 0 ? "text-emerald-700" : r.profit.marginMinor < 0 ? "text-rose-700" : "text-slate-700"}`}>{r.profit.marginMinor === null ? "Cost needed" : r.profit.marginMinor < 0 ? `Loss ${inrAmount(-r.profit.marginMinor / 100)}` : `Profit ${inrAmount(r.profit.marginMinor / 100)}`}</span>}{r.stage === "ENQUIRY" || r.stage === "QUOTED" ? <span className="text-xs text-slate-500">Not booked yet</span> : r.balanceMinor > 0 ? <span className="text-xs text-amber-800">{inrAmount(r.balanceMinor / 100)} due</span> : <span className="text-xs text-slate-500">Nothing due</span>}</span>}
        </Link>
      </li>;
    })}
  </ul>;
}
