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
  return !["WON", "LOST"].includes(lead.stage) && lead.quotes[0]?.id === quote.id &&
    quote.state === "DRAFT" && new Date(quote.expiresAt).getTime() > now;
}

export function canStartQuote(lead: SalesLead) {
  return !["WON", "LOST"].includes(lead.stage) && lead.quotes[0]?.state !== "ACCEPTED";
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

export function customerPrerequisite(canCreateCustomer: boolean) {
  return canCreateCustomer
    ? { action: "Open Customers to add a customer", explanation: "Open Customers, choose New customer, then return to Enquiries & quotes to start a new enquiry. The customer must be available in your permitted scope." }
    : { action: "Review permitted customers", explanation: "Ask an administrator to add or assign an eligible customer within your scope. You do not have permission to create a customer." };
}
