import { TRIP_STAGES, TRIP_STAGE_LABEL, type TripStage } from "@/lib/trip-stage";

/** Enquiry → Quoted → Booked → Travelling → Done. Cancelled trips show a red pill instead. */
export default function TripStageBar({ stage, compact = false }: { stage: TripStage; compact?: boolean }) {
  if (stage === "CANCELLED") return <span className="inline-flex w-fit items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Cancelled</span>;
  const at = TRIP_STAGES.indexOf(stage);
  if (compact) return <span className="inline-flex items-center gap-1.5" aria-label={`Stage: ${TRIP_STAGE_LABEL[stage]}`}>
    <span className="flex gap-0.5" aria-hidden="true">{TRIP_STAGES.map((s, i) => <span key={s} className={`h-1.5 w-4 rounded-full ${i < at ? "bg-teal-500" : i === at ? "bg-teal-700" : "bg-slate-200"}`} />)}</span>
    <span className="text-xs font-semibold text-slate-700">{TRIP_STAGE_LABEL[stage]}</span>
  </span>;
  return <ol className="!m-0 flex flex-wrap !list-none gap-1 !p-0" aria-label="Trip stage">
    {TRIP_STAGES.map((s, i) => <li key={s} aria-current={i === at ? "step" : undefined} className={`min-w-0 flex-1 rounded-md px-1 py-2 text-center text-micro font-semibold tracking-normal sm:text-sm ${i < at ? "bg-teal-100 text-teal-900" : i === at ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-500"}`}>{TRIP_STAGE_LABEL[s]}</li>)}
  </ol>;
}
