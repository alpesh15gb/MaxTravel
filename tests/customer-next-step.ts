import assert from "node:assert/strict";
import { customerNextStep, type NextStepInput } from "../src/lib/customer-next-step";

const base: NextStepInput = { customerId: "c1", travellerCount: 1, canAddTraveller: true, canRecordPayment: true, canCreateBooking: true, outstanding: 0, pendingDocs: 0, bookings: [], visaCases: [] };
const step = (o: Partial<NextStepInput>) => customerNextStep({ ...base, ...o });

assert.equal(step({ travellerCount: 0 })?.action, "ADD_TRAVELLER");
assert.equal(step({ travellerCount: 0, canAddTraveller: false })?.label, "Start a trip");
assert.equal(step({})?.href, "/trips/new?customer=c1");
assert.equal(step({ bookings: [{ id: "b2", bookingNo: "BK-2", status: "PNR_CREATED", ticketingDeadline: null, caseId: "t9" }] })?.href, "/trips/t9");
assert.equal(step({ visaCases: [{ id: "v3", caseNo: "VC-3", stageKey: "SUBMITTED", stage: "Submitted", caseId: "t8" }] })?.href, "/trips/t8");
assert.equal(step({ bookings: [{ id: "b1", bookingNo: "BK-1", status: "PNR_CREATED", ticketingDeadline: "2026-11-10T00:00:00Z" }], outstanding: 500 })?.href, "/ticketing/b1");
assert.match(step({ outstanding: 150000 })?.href ?? "", /^\/payments\?action=record&customer=c1$/);
assert.equal(step({ outstanding: 150000, canRecordPayment: false, pendingDocs: 2 })?.tab, "documents");
assert.equal(step({ visaCases: [{ id: "v1", caseNo: "VC-1", stageKey: "CLOSED", stage: "Closed" }, { id: "v2", caseNo: "VC-2", stageKey: "SUBMITTED", stage: "Submitted" }] })?.href, "/visa/v2");
assert.equal(step({ canCreateBooking: false }), null);
console.log("Customer next-step rules passed: traveller first, ticket deadline, payment, documents, visa, idle.");
