import assert from "node:assert/strict";
import { bookingCharge, hasCancellationAllocation, cancellationRefundAvailable, receivablesFrom, netReceived } from "../src/lib/receivables";
const cancelled = (supplier: number, fee: number) => ({ status: "CANCELLED", sellingPrice: 1000, cancellationSupplierCharge: supplier, cancellationAgencyFee: fee });
for (const [paid, supplier, fee, refund, owed] of [[1000,0,0,1000,0],[1000,200,100,700,0],[1000,900,100,0,0],[0,200,100,0,300],[100,200,100,0,200]]) {
  const b=cancelled(supplier,fee);const charge=bookingCharge(b);
  assert.equal(cancellationRefundAvailable(charge,paid),refund);
  assert.equal(receivablesFrom({bookings:[{...b,received:paid}]}).total,owed);
  const refunds=refund?[{amount:refund,status:"PAID"}]:[];
  assert.equal(charge-netReceived(paid,refunds),owed,"Charge − receipts + paid refunds reconciles exactly");
}
const b=cancelled(200,100);
assert.equal(cancellationRefundAvailable(bookingCharge(b),1000,[{amount:700,status:"REQUESTED"}]),0,"Requests reserve once");
assert.equal(cancellationRefundAvailable(bookingCharge(b),1000,[{amount:700,status:"REJECTED"}]),700,"Rejection releases reservation, not price");
assert.equal(cancellationRefundAvailable(bookingCharge(b),1000,[{amount:700,status:"PAID"}]),0);
assert.equal(bookingCharge({status:"TICKETED",sellingPrice:1000}),1000);
assert.equal(receivablesFrom({bookings:[{status:"TICKETED",sellingPrice:1000,received:100,refunds:[{amount:100,status:"PAID"}]}]}).total,1000,"Full deposit cash refund does not write off active sale");
assert.equal(hasCancellationAllocation({status:"CANCELLED",sellingPrice:1000}),false);
assert.equal(bookingCharge({status:"CANCELLED",sellingPrice:1000}),0,"Legacy unclassified demand preserved");
console.log("Cancellation accounting unit invariants passed (full/partial/zero refunds, deposit/unpaid, rejection, reservation, active cash refund, legacy).");
