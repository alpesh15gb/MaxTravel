import assert from 'node:assert/strict';
import {hotelDate,hotelStayProblem,MANUAL_HOTEL_STATUSES} from '../src/lib/manual-hotel';
const valid={hotelName:'Synthetic stay',pnr:'SUPPLIER-REFERENCE',hotelCheckIn:hotelDate('2099-01-01'),hotelCheckOut:hotelDate('2099-01-03')};
assert.equal(hotelStayProblem(valid,true),null);
for(const field of ['hotelName','pnr','hotelCheckIn','hotelCheckOut'])assert(hotelStayProblem({...valid,[field]:null},true));
assert(hotelStayProblem({...valid,hotelCheckOut:hotelDate('2099-01-01')}));
assert(hotelStayProblem({...valid,hotelCheckOut:hotelDate('2098-12-31')}));
for(const value of ['2099-02-29','2099-01-32','2099-01-01T00:00:00Z','bad'])assert.throws(()=>hotelDate(value));
assert.equal(hotelDate('2028-02-29')?.toISOString(),'2028-02-29T00:00:00.000Z');
assert(!MANUAL_HOTEL_STATUSES.includes('TICKETED'));assert(!MANUAL_HOTEL_STATUSES.includes('PNR_CREATED'));assert(MANUAL_HOTEL_STATUSES.includes('CONFIRMED'));
console.log('PASS manual hotel: strict stay dates/reference, confirmation prerequisites, hotel-specific states');

// Legacy imported hotel deadlines must not enter either pulse or reminder paths.
import {airlineDeadlineEligible} from "../src/lib/booking-deadline";
for(const status of ["PNR_CREATED","ON_HOLD","PAYMENT_AWAITED","QUOTE_SENT"]){const legacy={product:"HOTEL",status,ticketingDeadline:new Date("2099-01-01")};assert.equal(airlineDeadlineEligible(legacy,true),false);assert.equal(airlineDeadlineEligible(legacy),false);assert.equal(airlineDeadlineEligible({...legacy,product:"FLIGHT"},true),true);assert.equal(airlineDeadlineEligible({...legacy,product:"FLIGHT"}),status!=="QUOTE_SENT");}
assert.equal(airlineDeadlineEligible({product:"FLIGHT",status:"CONFIRMED",ticketingDeadline:new Date()}),false);
console.log("PASS airline deadlines: legacy HOTEL excluded, existing FLIGHT reminder/pulse states preserved");
assert.equal(airlineDeadlineEligible({product:"LEGACY_IMPORT",status:"ON_HOLD",ticketingDeadline:new Date()}),true,"Unknown legacy products retain prior behavior");
