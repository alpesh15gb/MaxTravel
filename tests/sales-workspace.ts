import assert from "node:assert/strict";
import {
  matchingEnquiries, canPublishQuote, canStartQuote, quoteExplanation, hasPublishedShare, privateLinkGuidance, customerPrerequisite,
  type SalesLead, type SalesQuote,
} from "../src/app/(app)/sales/sales-workspace";

const now = Date.parse("2026-10-22T12:00:00Z");
const quote: SalesQuote = { id: "quote-2", version: 2, state: "DRAFT", totalMinor: 500000,
  costMinor: 400000, bookingId: null, expiresAt: "2026-10-23T12:00:00Z", terms: "Fixture only" };
const lead: SalesLead = { id: "lead-1", customerId: "customer-1", title: "Family trip", source: "Referral",
  product: "HOTEL", stage: "NEW", destination: "Kerala", followUpAt: null, quotes: [quote] };
const customers = [{ id: "customer-1", name: "Synthetic customer", code: "CUS-001" }];

assert.equal(matchingEnquiries([lead], customers, "  KERALA  ", "ALL").length, 1);
assert.equal(matchingEnquiries([lead], customers, "cus-001", "NEW").length, 1);
assert.equal(matchingEnquiries([lead], customers, "synthetic", "LOST").length, 0);
assert.equal(matchingEnquiries([lead], [], "family", "ALL").length, 1, "A missing picker customer must not hide a permitted enquiry");
assert.equal(matchingEnquiries([lead], customers, "no match", "ALL").length, 0);
assert.equal(lead.quotes.length, 1, "Filters never mutate source data");

assert.equal(canPublishQuote(lead, quote, now), true);
assert.equal(canPublishQuote({ ...lead, stage: "LOST" }, quote, now), false);
assert.equal(canPublishQuote({ ...lead, stage: "WON" }, quote, now), false);
assert.equal(canPublishQuote(lead, { ...quote, expiresAt: new Date(now).toISOString() }, now), false);
assert.equal(canPublishQuote(lead, { ...quote, expiresAt: "not a date" }, now), false);
assert.equal(canPublishQuote(lead, { ...quote, id: "older-draft", version: 1 }, now), false);
assert.equal(canPublishQuote(lead, { ...quote, state: "PUBLISHED" }, now), false);
assert.equal(canStartQuote(lead), true);
assert.equal(canStartQuote({ ...lead, stage: "WON" }), false);
assert.equal(canStartQuote({ ...lead, quotes: [{ ...quote, state: "ACCEPTED" }] }), false);
assert.match(quoteExplanation(quote), /Staff-only draft/);
assert.match(quoteExplanation({ ...quote, state: "PUBLISHED" }), /not the public package catalogue/);
assert.match(quoteExplanation({ ...quote, state: "ACCEPTED" }), /no supplier reservation/);
assert.match(quoteExplanation({ ...quote, bookingId: "booking-1" }), /Supplier confirmation and payment are managed separately/);
assert.match(quoteExplanation({ ...quote, state: "WITHDRAWN" }), /no longer valid/);
assert.match(quoteExplanation({ ...quote, state: "SUPERSEDED" }), /no longer valid/);
assert.equal(hasPublishedShare([lead], quote.id), false, "Drafts do not validate a private link");
assert.equal(hasPublishedShare([{ ...lead, quotes: [{ ...quote, state: "PUBLISHED" }] }], quote.id), true);
for (const state of ["WITHDRAWN", "SUPERSEDED", "ACCEPTED"]) {
  assert.equal(hasPublishedShare([{ ...lead, quotes: [{ ...quote, state }] }], quote.id), false);
}
assert.equal(hasPublishedShare([{ ...lead, quotes: [{ ...quote, id: "different-quote", state: "PUBLISHED" }] }], quote.id), false, "Same enquiry title never validates another quote’s link");
assert.equal(hasPublishedShare([], quote.id), false, "Missing/out-of-scope records fail closed");
assert.equal(hasPublishedShare([lead], null), false);
console.log("Sales workspace presentation tests passed: scoped search, state eligibility, private-versus-booking lifecycle.");

const published = { ...quote, state: "PUBLISHED" };
const publishedLead = { ...lead, quotes: [published] };
const replacement = privateLinkGuidance(publishedLead, published, true)!;
assert.match(replacement, /cannot be retrieved/);
assert.match(replacement, /does not withdraw/);
assert.match(replacement, /latest unexpired draft/);
assert.match(replacement, /saving a draft does not/);
assert.match(replacement, /Withdraw quote only if/);
assert.doesNotMatch(privateLinkGuidance(publishedLead, published, false)!, /choose New quote version/);
assert.match(privateLinkGuidance(publishedLead, published, false)!, /colleague with quotation and finance permissions/);
for (const stage of ["WON", "LOST"]) {
  assert.match(privateLinkGuidance({ ...publishedLead, stage }, published, true)!, /Review the enquiry stage/);
}
assert.match(privateLinkGuidance({ ...publishedLead, quotes: [{ ...quote, state: "ACCEPTED" }, published] }, published, true)!, /Do not withdraw an accepted proposal just to recover a link/);
for (const state of ["DRAFT", "ACCEPTED", "WITHDRAWN", "SUPERSEDED"]) {
  assert.equal(privateLinkGuidance(lead, { ...quote, state }, true), null);
}
assert.equal(privateLinkGuidance(publishedLead, { ...published, bookingId: "booking-1" }, true), null);
assert.equal(customerPrerequisite(true).action, "Open Customers to add a customer");
assert.match(customerPrerequisite(true).explanation, /permitted scope/);
assert.equal(customerPrerequisite(false).action, "Review permitted customers");
assert.match(customerPrerequisite(false).explanation, /do not have permission/);
console.log("Flow clarity guidance passed: no raw-link retrieval, permission-aware replacement and customer prerequisite.");
