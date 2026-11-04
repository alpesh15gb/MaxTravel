import { istDayKey } from "./dates";

export type TripStage = "ENQUIRY" | "QUOTED" | "BOOKED" | "TRAVELLING" | "DONE" | "CANCELLED";
export const TRIP_STAGES: TripStage[] = ["ENQUIRY", "QUOTED", "BOOKED", "TRAVELLING", "DONE"];
export const TRIP_STAGE_LABEL: Record<TripStage, string> = {
  ENQUIRY: "Enquiry", QUOTED: "Quoted", BOOKED: "Booked", TRAVELLING: "Travelling", DONE: "Done", CANCELLED: "Cancelled",
};
export type TripStageInput = {
  caseStatus: string;
  /** travelEndDate: return flight, hotel check-out or last service day, when known. */
  bookings: { status: string; travelDate: Date | null; travelEndDate?: Date | null }[];
  /** stageKey: the visa workflow stage (ENQUIRY, ASSESSMENT … REJECTED, CLOSED). Missing = treated as in progress. */
  visas: { travelDate: Date | null; travelEndDate: Date | null; stageKey?: string }[];
  leads: { stage: string; travelDate: Date | null; quoteStates: string[] }[];
  today: Date;
};

const DEAD = new Set(["CANCELLED", "VOID", "REFUNDED"]);
const PRE_SALE = new Set(["ENQUIRY", "QUOTE_SENT"]);
const VISA_PRE_SALE = new Set(["ENQUIRY", "ASSESSMENT"]);
const VISA_DEAD = new Set(["REJECTED", "CANCELLED", "WITHDRAWN"]);
const isLive = (status: string) => !DEAD.has(status) && !PRE_SALE.has(status);
export const isDeadVisaStage = (key: string | undefined) => Boolean(key && VISA_DEAD.has(key));
const isLiveVisa = (key: string | undefined) => !isDeadVisaStage(key) && !(key && VISA_PRE_SALE.has(key));

export function tripDates(input: TripStageInput): { start: Date | null; end: Date | null } {
  const dates: Date[] = [];
  for (const b of input.bookings) if (isLive(b.status)) for (const d of [b.travelDate, b.travelEndDate]) if (d) dates.push(d);
  for (const v of input.visas) if (isLiveVisa(v.stageKey)) for (const d of [v.travelDate, v.travelEndDate]) if (d) dates.push(d);
  if (!dates.length) return { start: null, end: null };
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

export function tripStage(input: TripStageInput): TripStage {
  if (input.caseStatus === "CANCELLED") return "CANCELLED";
  if (input.caseStatus === "COMPLETED") return "DONE";
  const { bookings, visas, leads } = input;
  const services = bookings.length + visas.length;
  const allDead = bookings.every(b => DEAD.has(b.status)) && visas.every(v => isDeadVisaStage(v.stageKey));
  if (services > 0 && allDead && !leads.some(l => l.stage !== "LOST")) return "CANCELLED";
  const booked = bookings.some(b => isLive(b.status)) || visas.some(v => isLiveVisa(v.stageKey));
  if (booked) {
    const { start, end } = tripDates(input);
    const now = istDayKey(input.today);
    if (start && end) {
      if (istDayKey(start) <= now && now <= istDayKey(end)) return "TRAVELLING";
      if (istDayKey(end) < now) return "DONE";
    }
    return "BOOKED";
  }
  if (bookings.some(b => b.status === "QUOTE_SENT") || leads.some(l => l.stage === "QUOTED" || l.quoteStates.some(q => q !== "DRAFT" && q !== "SUPERSEDED"))) return "QUOTED";
  return "ENQUIRY";
}
