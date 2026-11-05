import assert from "node:assert/strict";
import { invoiceView } from "../src/lib/invoice-view";

const inv = { amount: 60000, amountPaid: 0, status: "UNPAID" };
// A standalone invoice uses its own receipts.
assert.deepEqual(invoiceView({ ...inv, amountPaid: 10000, status: "PARTIAL", booking: null, visaCase: null }), { paid: 10000, balance: 50000, status: "PARTIAL" });
assert.deepEqual(invoiceView({ ...inv, status: "CREDITED", booking: null, visaCase: null }), { paid: 0, balance: 0, status: "CREDITED" });
// Linked to a booking: money received against the booking counts, even with no receipt on the invoice itself.
const booking = (o: object) => ({ status: "TICKETED", sellingPrice: 60000, cancellationSupplierCharge: null, cancellationAgencyFee: null, payments: [{ amount: 20000 }], refunds: [], ...o });
assert.deepEqual(invoiceView({ ...inv, booking: booking({}), visaCase: null }), { paid: 20000, balance: 40000, status: "PARTIAL" });
assert.deepEqual(invoiceView({ ...inv, booking: booking({ payments: [] }), visaCase: null }), { paid: 0, balance: 60000, status: "UNPAID" });
assert.deepEqual(invoiceView({ ...inv, booking: booking({ payments: [{ amount: 60000 }] }), visaCase: null }), { paid: 60000, balance: 0, status: "PAID" });
// A smaller part invoice is never shown owing more than its own amount.
assert.equal(invoiceView({ ...inv, amount: 10000, booking: booking({}), visaCase: null }).balance, 10000);
// Cancelled booking: the invoice is replaced by the cancellation settlement.
const cancelled = booking({ status: "CANCELLED", cancellationSupplierCharge: 5000, cancellationAgencyFee: 1000, refunds: [{ amount: 14000, status: "PAID" }] });
assert.deepEqual(invoiceView({ ...inv, booking: cancelled, visaCase: null }), { paid: 0, balance: 0, status: "CANCELLED" });
// Linked to a visa.
assert.deepEqual(invoiceView({ ...inv, amount: 8000, booking: null, visaCase: { sellingPrice: 8000, amountReceived: 3000 } }), { paid: 3000, balance: 5000, status: "PARTIAL" });
console.log("Invoice view passed.");
