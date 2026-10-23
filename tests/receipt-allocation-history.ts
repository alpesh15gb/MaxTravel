import assert from "node:assert/strict";
import { historicalReceiptAllocation, type AllocationAudit, type AllocationReceipt } from "../src/lib/receipt-allocation-history";

export function checkReceiptAllocationHistory() {
  let passed=0;
  const check=(name:string,run:()=>void)=>{run();passed++;console.log(`✓ Allocation history: ${name}`);};
  const receipt:AllocationReceipt={id:"receipt",receiptNo:"RCP-TEST",amount:40,createdAt:new Date("2026-10-01T12:00:00+05:30"),bookingId:"booking",visaCaseId:null,invoiceId:null};
  const end=new Date("2026-10-03T00:00:00+05:30"),now=new Date("2026-10-04T12:00:00+05:30");
  const event=(target=receipt,at=new Date("2026-10-03T12:00:00+05:30")):AllocationAudit=>({entityId:target.id,at,detail:JSON.stringify({receiptNo:target.receiptNo,amount:target.amount,bookingId:target.bookingId,visaCaseId:target.visaCaseId,invoiceId:target.invoiceId})});
  const resolve=(audits:AllocationAudit[],target=receipt)=>historicalReceiptAllocation(target,audits,end,now);
  const unapplied={bookingId:null,visaCaseId:null,invoiceId:null};
  check("known later allocation remains unapplied",()=>assert.deepEqual(resolve([event()]),{supported:true,allocation:unapplied}));
  check("IST cutoff is exclusive",()=>assert.deepEqual(resolve([event(receipt,end)]),{supported:true,allocation:unapplied}));
  check("last millisecond of IST end day is included",()=>assert.deepEqual(resolve([event(receipt,new Date(end.getTime()-1))]),{supported:true,allocation:{bookingId:"booking",visaCaseId:null,invoiceId:null}}));
  check("unallocated receipt needs no invented timestamp",()=>assert.deepEqual(resolve([],{...receipt,...unapplied}),{supported:true,allocation:unapplied}));
  check("missing evidence for a linked receipt is unsupported",()=>assert.deepEqual(resolve([]),{supported:false}));
  check("duplicate audit records are not guessed away",()=>assert.deepEqual(resolve([event(),event()]),{supported:false}));
  check("conflicting audit records are unsupported",()=>assert.deepEqual(resolve([event(),event({...receipt,bookingId:"other"})]),{supported:false}));
  check("malformed JSON is unsupported",()=>assert.deepEqual(resolve([{...event(),detail:"{"}]),{supported:false}));
  check("non-object audit payload is unsupported",()=>assert.deepEqual(resolve([{...event(),detail:"[]"}]),{supported:false}));
  check("missing payload is unsupported",()=>assert.deepEqual(resolve([{...event(),detail:null}]),{supported:false}));
  check("payment identity must match",()=>assert.deepEqual(resolve([{...event(),entityId:"other"}]),{supported:false}));
  check("receipt reference must match",()=>assert.deepEqual(resolve([event({...receipt,receiptNo:"OTHER"})]),{supported:false}));
  check("amount must match exactly in paise",()=>assert.deepEqual(resolve([event({...receipt,amount:40.01})]),{supported:false}));
  check("non-money precision is rejected",()=>assert.deepEqual(resolve([event({...receipt,amount:40.001})]),{supported:false}));
  check("target must match current one-way allocation",()=>assert.deepEqual(resolve([event({...receipt,bookingId:"other"})]),{supported:false}));
  check("contradictory event for current unapplied receipt is unsupported",()=>assert.deepEqual(resolve([event()],{...receipt,...unapplied}),{supported:false}));
  check("an allocation cannot have no target",()=>{const target={...receipt,...unapplied};assert.deepEqual(resolve([event(target)],target),{supported:false});});
  check("booking and visa cannot both be targets",()=>{const target={...receipt,visaCaseId:"visa"};assert.deepEqual(resolve([event(target)],target),{supported:false});});
  check("blank target IDs are rejected",()=>{const target={...receipt,bookingId:" "};assert.deepEqual(resolve([event(target)],target),{supported:false});});
  check("omitted target fields do not mean known null",()=>assert.deepEqual(resolve([{...event(),detail:JSON.stringify({receiptNo:receipt.receiptNo,amount:40,bookingId:"booking"})}]),{supported:false}));
  check("invalid audit date is rejected",()=>assert.deepEqual(resolve([event(receipt,new Date(NaN))]),{supported:false}));
  check("future audit date is rejected",()=>assert.deepEqual(resolve([event(receipt,new Date(now.getTime()+1))]),{supported:false}));
  check("audit exactly at now is valid",()=>assert.equal(resolve([event(receipt,now)]).supported,true));
  check("audit cannot precede receipt creation",()=>assert.deepEqual(resolve([event(receipt,new Date(receipt.createdAt.getTime()-1))]),{supported:false}));
  for(const [name,targets] of [["standalone invoice",{bookingId:null,visaCaseId:null,invoiceId:"invoice"}],["visa",{bookingId:null,visaCaseId:"visa",invoiceId:null}],["booking-linked invoice",{bookingId:"booking",visaCaseId:null,invoiceId:"invoice"}],["visa-linked invoice",{bookingId:null,visaCaseId:"visa",invoiceId:"invoice"}]] as const){
    check(`${name} preserves the full validated target tuple`,()=>{const target={...receipt,...targets};assert.deepEqual(resolve([event(target,new Date(end.getTime()-1))],target),{supported:true,allocation:targets});});
  }
  return passed;
}
