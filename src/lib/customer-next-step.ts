import { inrAmount } from "./money";

export interface NextStepInput {
  customerId: string;
  travellerCount: number;
  canAddTraveller: boolean;
  canRecordPayment: boolean;
  canCreateBooking: boolean;
  outstanding: number;
  pendingDocs: number;
  bookings: { id: string; bookingNo: string; status: string; ticketingDeadline: string | null; caseId?: string | null }[];
  visaCases: { id: string; caseNo: string; stageKey: string; stage: string; caseId?: string | null }[];
}
export type NextStep = { title: string; detail: string; label: string; href?: string; tab?: string; action?: "ADD_TRAVELLER" };

// One suggested action per customer, picked in the order an agent would naturally work.
export function customerNextStep(i: NextStepInput): NextStep | null {
  if (!i.travellerCount && i.canAddTraveller)
    return { title: "Add the first traveller", detail: "Bookings and visas need at least one traveller on this customer.", label: "Add traveller", action: "ADD_TRAVELLER" };
  const unticketed = i.bookings.find(b => b.status === "PNR_CREATED");
  if (unticketed)
    return { title: `Issue the ticket for ${unticketed.bookingNo}`, detail: unticketed.ticketingDeadline ? `Ticketing deadline ${unticketed.ticketingDeadline.slice(0, 10)}.` : "The seat is held but not ticketed yet.", label: unticketed.caseId ? "Open trip" : "Open booking", href: unticketed.caseId ? `/trips/${unticketed.caseId}` : `/ticketing/${unticketed.id}` };
  if (i.outstanding > 0 && i.canRecordPayment)
    return { title: `Collect ${inrAmount(i.outstanding)}`, detail: "This customer still owes money on open bookings or visas.", label: "Record payment", href: `/payments?action=record&customer=${i.customerId}` };
  if (i.pendingDocs > 0)
    return { title: `Review ${i.pendingDocs} document${i.pendingDocs === 1 ? "" : "s"}`, detail: "Some documents are still required, awaiting review or need a re-upload.", label: "Open documents", tab: "documents" };
  const visa = i.visaCases.find(v => !["CLOSED", "DELIVERED"].includes(v.stageKey));
  if (visa)
    return { title: `Continue visa ${visa.caseNo}`, detail: `Current stage: ${visa.stage}.`, label: visa.caseId ? "Open trip" : "Open visa case", href: visa.caseId ? `/trips/${visa.caseId}` : `/visa/${visa.id}` };
  if (i.canCreateBooking)
    return { title: "Nothing is waiting on this customer", detail: "Start a trip when they need a booking, visa or quote.", label: "Start a trip", href: `/trips/new?customer=${i.customerId}` };
  return null;
}
