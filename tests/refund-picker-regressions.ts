import assert from "node:assert/strict";
import { bookingCharge, cancellationRefundAvailable, unencumberedBalance } from "../src/lib/receivables";
const booking = { status: "CANCELLED", sellingPrice: 1500, cancellationSupplierCharge: 200, cancellationAgencyFee: 100 };
const refunds = [{ amount: 200, status: "PAID" }, { amount: 100, status: "REQUESTED" }, { amount: 50, status: "REJECTED" }];
assert.equal(cancellationRefundAvailable(bookingCharge(booking), 1000, refunds), 400, "Picker subtracts retained charges and both completed/reserved refunds once");
assert.equal(cancellationRefundAvailable(bookingCharge(booking), 100, []), 0, "Unpaid cancellation demand must not advertise refundable cash");
assert.equal(unencumberedBalance(1000, refunds), 700, "Active booking reserves refunds but does not subtract sale price");
assert.equal(cancellationRefundAvailable(bookingCharge({status:"CANCELLED", sellingPrice:1500}), 1000, refunds), 700, "Legacy unknown charges are not invented");
console.log("Refund picker balance scenarios passed.");
