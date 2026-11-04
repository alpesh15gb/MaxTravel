import { istDayKey } from "./dates";

export type TripStage = "ENQUIRY" | "QUOTED" | "BOOKED" | "TRAVELLING" | "DONE" | "CANCELLED";
export const TRIP_STAGES: TripStage[] = ["ENQUIRY", "QUOTED", "BOOKED", "TRAVELLING", "DONE"];
export const TRIP_STAGE_LABEL: Record<TripStage, string> = {
  ENQUIRY: "Enquiry", QUOTED: "Quoted", BOOKED: "Booked", TRAVELLING: "Travelling", DONE: "Done", CANCELLED: "Cancelled",
};
export type TripStageInput = {
  caseStatus: string;
  bookings: { status: string; travelDate: Date | null }[];
  visas: { travelDate: Date | null; travelEndDate: Date | null }[];
  leads: { stage: string; travelDate: Date | null; quoteStates: string[] }[];
  today: Date;
};

const DEAD = new Set(["CANCELLED", "VOID", "REFUNDED"]);
const PRE_SALE = new Set(["ENQUIRY", "QUOTE_SENT"]);
const isLive = (status: string) => !DEAD.has(status) && !PRE_SALE.has(status);

export function tripDates(input: TripStageInput): { start: Date | null; end: Date | null } {
  const dates: Date[] = [];
  for (const b of input.bookings) if (isLive(b.status) && b.travelDate) dates.push(b.travelDate);
  for (const v of input.visas) for (const d of [v.travelDate, v.travelEndDate]) if (d) dates.push(d);
  if (!dates.length) return { start: null, end: null };
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

export function tripStage(input: TripStageInput): TripStage {
  if (input.caseStatus === "CANCELLED") return "CANCELLED";
  if (input.caseStatus === "COMPLETED") return "DONE";
  const { bookings, visas, leads } = input;
  if (bookings.length && bookings.every(b => DEAD.has(b.status)) && !visas.length && !leads.some(l => l.stage !== "LOST")) return "CANCELLED";
  const booked = bookings.some(b => isLive(b.status)) || visas.length > 0;
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
