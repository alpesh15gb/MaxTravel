// Test-only provider boundary. Never imported by application runtime code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.TWO_APP_TRANSACTION_FIXTURE,'loopback-only');
const database=new URL(process.env.DATABASE_URL);
assert.equal(database.hostname,'127.0.0.1');
assert.equal(database.pathname,'/bridge_booking_verification');
const stateFile=process.env.TWO_APP_PSP_STATE,logFile=process.env.TWO_APP_PROVIDER_LOG;
assert(stateFile&&logFile);
const original=globalThis.fetch;
const option={optionId:'bridge-hotel-option',pricing:{totalPrice:5000,currency:'INR',mf:0,mft:0},cancellation:{isRefundable:true,penalties:[]},compliance:{panRequired:false,passportRequired:false,gstType:'NA'}};
const state=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const save=value=>fs.writeFileSync(stateFile,JSON.stringify(value));
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
 if(['127.0.0.1','localhost'].includes(url.hostname))return original(input,init);
 const payload=init?.body?JSON.parse(String(init.body)):{};
 const ok=value=>Response.json(value);
 fs.appendFileSync(logFile,JSON.stringify({host:url.hostname,path:url.pathname,method:init?.method||'GET',at:new Date().toISOString()})+'\n');
 if(url.hostname==='api.razorpay.com'){
  const data=state();
  if(url.pathname==='/v1/orders'){
   const id='order_'+randomUUID().replaceAll('-','');data[id]={id,amount:payload.amount,currency:payload.currency};save(data);return ok(data[id]);
  }
  if(url.pathname.startsWith('/v1/payments/')){
   const id=url.pathname.split('/')[3],orderId='order_'+id.replace(/^pay_/,'');const order=data[orderId];assert(order,'Payment must bind a previously created fixture order');
   return ok({id,order_id:orderId,amount:order.amount,currency:order.currency,status:'captured',method:'card'});
  }
 }
 if(url.hostname==='apitest.tripjack.com'){
  if(url.pathname.endsWith('/user-detail'))return ok({status:{success:true},walletBalance:1000000});
  if(url.pathname.endsWith('/air-search-all')){const route=payload.searchQuery.routeInfos[0];return ok({status:{success:true},searchResult:{tripInfos:{ONWARD:[{sI:[{id:'s1',da:{code:route.fromCityOrAirport.code},aa:{code:route.toCityOrAirport.code},dt:route.travelDate+'T10:00',at:route.travelDate+'T12:00',fD:{aI:{code:'6E',name:'Fixture airline'},fN:'100'},duration:120}],totalPriceList:[{id:'bridge-flight-price',fD:{ADULT:{fC:{TF:5000}}}}]}]}}});}
  if(url.pathname.endsWith('/review'))return ok({status:{success:true},bookingId:'TJ-BRIDGE-FLIGHT-'+randomUUID(),conditions:{st:900,isa:true},tripInfos:[{sI:[{id:'s1',da:{code:'BOM'},aa:{code:'DEL'}}]}],totalPriceInfo:{totalFareDetail:{fC:{TF:5000}}}});
  if(url.pathname.endsWith('/farerule'))return ok({status:{success:true},fareRule:{miscInfo:'Synthetic supplier terms. No real travel.'}});
  if(url.pathname.endsWith('/fare-validate')||url.pathname.endsWith('/air/book'))return ok({status:{success:true}});
  if(url.pathname.endsWith('/booking-details'))return ok({status:{success:true},order:{status:'SUCCESS',bookingId:payload.bookingId},itemInfos:{AIR:{travellerInfos:[{fN:'Bridge',lN:'Traveller',pnrDetails:{'BOM-DEL':'BRG123'},ticketNumberDetails:{'BOM-DEL':'SYNTHETIC-001'}}]}}});
 }
 if(['apitest-hms.tripjack.com','apitest-hotel-booker.tripjack.com'].includes(url.hostname)){
  if(url.pathname.endsWith('/listing'))return ok({status:{success:true},hotels:[{tjHotelId:'100001',name:'Bridge Fixture Hotel',options:[option]}]});
  if(url.pathname.endsWith('/pricing'))return ok({status:{success:true},options:[option],reviewHash:'bridge-review-hash'});
  if(url.pathname.endsWith('/review'))return ok({status:{success:true},bookingId:'TJ-BRIDGE-HOTEL-'+randomUUID(),option});
  if(url.pathname.endsWith('/hotel/book'))return ok({status:{success:true}});
  if(url.pathname.endsWith('/booking-details'))return ok({status:{success:true},order:{status:'SUCCESS',bookingId:payload.bookingId},hotel:{name:'Bridge Fixture Hotel'}});
 }
 throw Error('External request blocked by isolated two-app transaction fixture: '+url.hostname+url.pathname);
};
