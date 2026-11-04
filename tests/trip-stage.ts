import assert from "node:assert/strict";
import { tripStage, tripDates, TRIP_STAGES, TRIP_STAGE_LABEL, type TripStageInput } from "../src/lib/trip-stage";

// 2026-11-04 12:00 IST
const today = new Date("2026-11-04T06:30:00Z");
const day = (n: number) => new Date(today.getTime() + n * 86400000);
const base: TripStageInput = { caseStatus: "OPEN", bookings: [], visas: [], leads: [], today };
const stage = (o: Partial<TripStageInput>) => tripStage({ ...base, ...o });

assert.deepEqual(TRIP_STAGES, ["ENQUIRY", "QUOTED", "BOOKED", "TRAVELLING", "DONE"]);
assert.equal(TRIP_STAGE_LABEL.TRAVELLING, "Travelling");
assert.equal(stage({}), "ENQUIRY");
assert.equal(stage({ leads: [{ stage: "QUOTED", travelDate: null, quoteStates: [] }] }), "QUOTED");
assert.equal(stage({ leads: [{ stage: "NEW", travelDate: null, quoteStates: ["ACCEPTED"] }] }), "QUOTED");
assert.equal(stage({ leads: [{ stage: "NEW", travelDate: null, quoteStates: ["DRAFT", "SUPERSEDED"] }] }), "ENQUIRY");
assert.equal(stage({ bookings: [{ status: "TICKETED", travelDate: day(10) }] }), "BOOKED");
assert.equal(stage({ bookings: [{ status: "TICKETED", travelDate: today }] }), "TRAVELLING");
assert.equal(stage({ visas: [{ travelDate: day(-5), travelEndDate: day(-1) }] }), "DONE");
assert.equal(stage({ bookings: [{ status: "CANCELLED", travelDate: day(3) }], visas: [{ travelDate: day(20), travelEndDate: null }] }), "BOOKED");
assert.equal(stage({ bookings: [{ status: "CANCELLED", travelDate: day(3) }, { status: "VOID", travelDate: null }] }), "CANCELLED");
assert.equal(stage({ bookings: [{ status: "CANCELLED", travelDate: day(3) }], leads: [{ stage: "QUOTED", travelDate: null, quoteStates: [] }] }), "QUOTED");
assert.equal(stage({ caseStatus: "COMPLETED", bookings: [{ status: "TICKETED", travelDate: day(10) }] }), "DONE");
assert.equal(stage({ caseStatus: "CANCELLED" }), "CANCELLED");
assert.equal(stage({ bookings: [{ status: "ENQUIRY", travelDate: day(2) }] }), "ENQUIRY");
assert.equal(stage({ bookings: [{ status: "QUOTE_SENT", travelDate: day(2) }] }), "QUOTED");
// 23:30 IST yesterday is a different India day from today → past, not travelling
assert.equal(stage({ bookings: [{ status: "TICKETED", travelDate: new Date("2026-11-03T18:00:00Z") }] }), "DONE");
// 00:30 IST today is the same India day → travelling
assert.equal(stage({ bookings: [{ status: "TICKETED", travelDate: new Date("2026-11-03T19:00:00Z") }] }), "TRAVELLING");
const dates = tripDates({ ...base, bookings: [{ status: "TICKETED", travelDate: day(3) }, { status: "CANCELLED", travelDate: day(1) }], visas: [{ travelDate: day(2), travelEndDate: day(9) }] });
assert.equal(dates.start?.toISOString(), day(2).toISOString());
assert.equal(dates.end?.toISOString(), day(9).toISOString());
assert.deepEqual(tripDates(base), { start: null, end: null });
console.log("Trip stage rules passed.");
