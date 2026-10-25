/** Presentation-only sales helpers. The sales API remains the permission/state authority. */
export const SALES_STAGES = ["NEW", "QUALIFIED", "QUOTED", "WON", "LOST"] as const;

export type SalesQuote = {
  id: string; version: number; state: string; totalMinor: number | null;
  costMinor: number | null; items?: { description: string; quantity: number; priceMinor: number; costMinor: number }[]; bookingId: string | null; expiresAt: string; terms: string;
};
export type SalesLead = {
  baseRevision?: string;
  id: string; title: string; customerId: string; source: string; product: string;
  stage: string; notes?: string | null; travelDate?: string | null; budgetMinor?: number | null; lostReason?: string | null; destination: string | null; followUpAt: string | null; quotes: SalesQuote[];
};
export type SalesCustomer = { id: string; name: string; code: string };

export function matchingEnquiries(leads: SalesLead[], customers: SalesCustomer[], query: string, stage: string) {
  const names = new Map(customers.map(customer => [customer.id, `${customer.name} ${customer.code}`]));
  const needle = query.trim().toLocaleLowerCase();
  return leads.filter(lead => (stage === "ALL" || lead.stage === stage) &&
    (!needle || [lead.title, lead.source, lead.destination ?? "", lead.product, names.get(lead.customerId) ?? ""]
      .join(" ").toLocaleLowerCase().includes(needle)));
}

export function quoteExplanation(quote: SalesQuote) {
  if (quote.bookingId) return "Linked CRM booking created. Supplier confirmation and payment are managed separately.";
  switch (quote.state) {
    case "DRAFT": return "Staff-only draft. Not shared with the customer or published in the package catalogue.";
    case "PUBLISHED": return "Private customer proposal. Accessible through its private link, not the public package catalogue.";
    case "ACCEPTED": return "Customer accepted this proposal. A CRM booking has not yet been created; no supplier reservation is implied.";
    case "WITHDRAWN": return "Withdrawn. The customer link is no longer valid.";
    case "SUPERSEDED": return "Replaced by a newer published version. This version’s customer link is no longer valid.";
    default: return "Review this quotation’s recorded state before taking the next action.";
  }
}

export function canPublishQuote(lead: SalesLead, quote: SalesQuote, now = Date.now()) {
  return !["WON", "LOST"].includes(lead.stage) && !lead.quotes.some(item => item.state === "ACCEPTED") && lead.quotes[0]?.id === quote.id &&
    quote.state === "DRAFT" && new Date(quote.expiresAt).getTime() > now;
}

export function canStartQuote(lead: SalesLead) {
  return !["WON", "LOST"].includes(lead.stage) && !lead.quotes.some(quote => quote.state === "ACCEPTED");
}

/** A one-time link must stay tied to its exact originating quote, never a title match. */
export function hasPublishedShare(leads: SalesLead[], quoteId: string | null) {
  return Boolean(quoteId && leads.some(lead => lead.quotes.some(quote => quote.id === quoteId && quote.state === "PUBLISHED")));
}

/** Guidance only: never reconstruct or persist a proposal capability token. */
export function privateLinkGuidance(lead: SalesLead, quote: SalesQuote, canQuote: boolean) {
  if (quote.state !== "PUBLISHED" || quote.bookingId) return null;
  const explanation = "An earlier private link cannot be retrieved here. Reloading or hiding the link does not withdraw the proposal.";
  if (!canQuote) return `${explanation} Ask a colleague with quotation and finance permissions to review the next step.`;
  if (!canStartQuote(lead)) return `${explanation} Review the enquiry stage and any accepted quotation before preparing another version. Do not withdraw an accepted proposal just to recover a link.`;
  return `${explanation} To issue a replacement, review the latest draft or choose New quote version, then save and publish the latest unexpired draft. Publishing it invalidates earlier published links; saving a draft does not. Use Withdraw quote only if the existing proposal should stop being available immediately.`;
}

/** Navigation only. Reviewing/preparing a draft must never publish a replacement. */
export function replacementQuoteAction(lead: SalesLead, quote: SalesQuote, canQuote: boolean, now = Date.now()) {
  if (!privateLinkGuidance(lead, quote, canQuote) || !canQuote || !canStartQuote(lead)) return null;
  const latest = lead.quotes[0];
  return latest && canPublishQuote(lead, latest, now)
    ? { kind: "review-draft" as const, quoteId: latest.id, version: latest.version }
    : { kind: "new-draft" as const };
}

export function customerPrerequisite(canCreateCustomer: boolean) {
  return canCreateCustomer
    ? { action: "Add customer here", explanation: "Create the customer without leaving this enquiry. Your enquiry fields stay on this page; the new customer is checked against your current permitted scope before selection." }
    : { action: "Search permitted customers", explanation: "Ask an administrator to add or assign an eligible customer within your scope. You do not have permission to create a customer." };
}

/** Orientation, not an action engine. Never changes records, publishes links or infers payment. */
export function enquiryNextStep(lead: SalesLead, now = Date.now()): { title: string; detail: string; quoteId?: string; version?: number } {
  if (hasConflictingAcceptedQuotes(lead)) return { title: "Review conflicting quotation records", detail: "More than one accepted or linked version is recorded. Do not choose a price or create another booking until your team has reviewed the acceptance and booking history." };
  const linked = lead.quotes.find(quote => quote.bookingId);
  if (linked) return { title: "Continue in the linked booking", detail: "Review supplier confirmation, invoices and receipts in the booking. An accepted quotation alone does not confirm travel or payment.", quoteId: linked.id, version: linked.version };
  if (lead.stage === "LOST") return { title: "Enquiry closed as lost", detail: "Review the lost reason before reopening. Closing an enquiry does not withdraw its proposal links or cancel supplier arrangements." };
  if (lead.stage === "WON") return { title: "Review the recorded booking", detail: "This enquiry is marked won, but no linked booking is available in this view. Refresh and review the customer history; do not create a second booking." };
  const accepted = lead.quotes.find(quote => quote.state === "ACCEPTED");
  if (accepted) return { title: "Accepted proposal needs booking review", detail: "Review the accepted version before creating its CRM booking. No supplier reservation, invoice or payment is created by acceptance.", quoteId: accepted.id, version: accepted.version };
  const latest = lead.quotes[0];
  if (!latest) return { title: "Prepare the first quotation", detail: "Confirm the request and next follow-up, then prepare a private draft. Saving a draft does not send it to the customer." };
  if (latest.state === "DRAFT") return { title: "Review the latest private draft", detail: canPublishQuote(lead, latest, now) ? "Check itinerary, prices, validity and terms before publishing. Any earlier published proposal stays available until replaced, withdrawn or expired." : "This draft cannot currently be published. Review its expiry and enquiry stage; prepare a new version if needed.", quoteId: latest.id, version: latest.version };
  if (latest.state === "PUBLISHED") return { title: "Follow up on the private proposal", detail: new Date(latest.expiresAt).getTime() > now ? "The proposal is published, not accepted. Confirm the intended recipient and arrange the next follow-up; publication does not prove delivery." : "The offer acceptance deadline has passed. Review the proposal and prepare a new version if the customer still wants to proceed.", quoteId: latest.id, version: latest.version };
  return { title: "Review quotation history", detail: "No accepted or linked proposal is shown. Review the recorded versions and customer request before preparing the next draft.", quoteId: latest.id, version: latest.version };
}

export function quoteExpiryLabel(quote: SalesQuote, now = Date.now()) {
  const deadline = new Date(quote.expiresAt).getTime();
  if (quote.state === "ACCEPTED" || quote.bookingId) return "Offer acceptance deadline";
  return ["DRAFT", "PUBLISHED"].includes(quote.state) && Number.isFinite(deadline) && deadline <= now ? "Expired offer · acceptance deadline" : "Offer acceptance deadline";
}

/** Inconsistent legacy data must not be resolved by choosing the newest consent. */
export function hasConflictingAcceptedQuotes(lead: SalesLead) {
  return lead.quotes.filter(quote => quote.state === "ACCEPTED" || quote.bookingId).length > 1;
}
