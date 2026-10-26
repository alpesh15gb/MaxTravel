import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bookingSourceLabel, isReservedBookingSource } from "../src/lib/booking-policy";

test("online booking keys have a display label while supplier identities remain unchanged", () => {
  for(const source of ["TRIPJACK_API","tripjack_api"," TRIPJACK_API "]) {
    assert.equal(bookingSourceLabel(source),"Online booking");
    assert.equal(isReservedBookingSource(source),true);
  }
  for(const source of ["Amadeus","Sabre","Direct airline","Example Hotel"])assert.equal(bookingSourceLabel(source),source);
  for(const source of [null,undefined,""])assert.equal(bookingSourceLabel(source),"-");
  assert.equal(isReservedBookingSource("Amadeus"),false);
});

test("booking facts use the display label and keep the separate supplier identity", () => {
  const source=readFileSync("src/app/(app)/ticketing/[id]/BookingView.tsx","utf8");
  assert.match(source,/k="Booking source" v=\{bookingSourceLabel\(b.gdsSource\)\}/);
  assert.match(source,/k="Supplier" v=\{b.supplier \?\? "[^"\n]+"\}/);
});

test("payable warning remains prepaid and provider-neutral without changing the guard", () => {
  const view=readFileSync("src/app/(app)/suppliers/SuppliersClient.tsx","utf8");
  assert.match(view,/Do not create a second payable for an online booking already paid from the prepaid wallet/);
  assert.doesNotMatch(view,/TripJack|\bUAT\b/);
  const route=readFileSync("src/app/api/suppliers/dues/route.ts","utf8");
  assert.match(route,/booking.gdsSource === "TRIPJACK_API"/);
  assert.match(route,/Online wallet bookings are prepaid; they cannot receive another supplier payable/);
});
