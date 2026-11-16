import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const prefix=path.join(path.resolve(tmpdir()),'max-ai-crm-enquiries-');
const directory=mkdtempSync(prefix),fixture=path.join(directory,'fixture.db');
assert(path.resolve(directory).startsWith(prefix));writeFileSync(fixture,'',{flag:'wx'});
process.env.DATABASE_URL='file:'+fixture.replaceAll('\\','/');
process.env.CRM_DATA_ENCRYPTION_KEY='a'.repeat(64);
const secret='synthetic-enquiry-signing-key-at-least-32-characters';
process.env.BOOKING_PLATFORM_SIGNING_KEYS=JSON.stringify({synthetic:secret});
const migrate=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','prisma/schema.prisma'],{env:process.env,encoding:'utf8'});
assert.equal(migrate.status,0,migrate.stderr+migrate.stdout);
const {prisma}=await import('../src/lib/db');
const {POST}=await import('../src/app/api/integrations/booking-platform/events/route');
const {salesLeadPage}=await import('../src/lib/sales-discovery');
const {ROLE_PERMISSIONS}=await import('../src/lib/permissions');
const {canConvertSalesProduct}=await import('../src/lib/sales-products');
const {projectSalesBudget}=await import('../src/lib/sales-budget');
const {platformEnquirySchema}=await import('../src/lib/platform-enquiries');
const future='2030-12-15';
function event(service:'VISA'|'INSURANCE'|'HOLIDAY'|'CRUISE'){
  const id=randomUUID(),now=new Date().toISOString();
  return {schemaVersion:1,eventId:randomUUID(),eventType:'enquiry.created',aggregateId:id,occurredAt:now,revision:1,payload:{enquiryId:id,reference:'ME-'+id.replaceAll('-','').slice(0,12).toUpperCase(),service,
    draft:{service,destination:'Synthetic destination',travelWindow:'December 2030',travelStart:future,adults:1,childAges:[6],...(service==='VISA'?{nationality:'Indian',purpose:'Tourism'}:{}),...(service==='INSURANCE'?{travellerAges:[35,6]}:{}),...(service==='HOLIDAY'?{departureCity:'Hyderabad'}:{}),budgetRupees:10000,budgetBasis:'PER_PERSON'},
    contact:{name:'Synthetic customer',email:'shared@example.test',preferredChannel:'EMAIL'},contactVerified:false,consentAt:now,createdAt:now}};
}
async function send(value:ReturnType<typeof event>,options:{raw?:string;signature?:string;timestamp?:string}={}){
  const raw=options.raw??JSON.stringify(value),timestamp=options.timestamp??String(Math.floor(Date.now()/1000));
  return POST(new Request('https://crm.example.test/api/integrations/booking-platform/events',{method:'POST',body:raw,headers:{'content-type':'application/json','x-maxtravel-key-id':'synthetic','x-maxtravel-event-id':value.eventId,'x-maxtravel-timestamp':timestamp,'x-maxtravel-signature':options.signature??createHmac('sha256',secret).update(`${timestamp}.${value.eventId}.${raw}`).digest('hex')}}));
}
try{
  const role=await prisma.role.create({data:{key:'OWNER',name:'Synthetic owner',desc:'Isolated fixture'}});
  const branch=await prisma.branch.create({data:{name:'Synthetic branch',code:'AI-TEST',city:'Test'}});
  const owner=await prisma.user.create({data:{name:'Synthetic owner',email:'owner@example.test',employeeCode:'AI-TEST',phone:'',passwordHash:'not-a-login',roleId:role.id,branchId:branch.id}});
  process.env.BOOKING_PLATFORM_OWNER_ID=owner.id;process.env.BOOKING_PLATFORM_BRANCH_ID=branch.id;
  const original=await prisma.customer.create({data:{code:'ORIGINAL',name:'Private existing customer',email:'shared@example.test',phone:'',city:'Original',branchId:branch.id,assignedToId:owner.id}});
  for(const service of ['VISA','INSURANCE','HOLIDAY','CRUISE'] as const){
    const input=event(service),response=await send(input);assert.equal(response.status,200,await response.clone().text());
    const receipt=await response.json();assert.equal(receipt.accepted,true);assert.equal(receipt.enquiryId,input.aggregateId);assert.match(receipt.crmReference,/^CASE-/);
    const lead=await prisma.salesLead.findUniqueOrThrow({where:{id:receipt.leadId},include:{serviceCase:true}});
    assert.equal(lead.product,service);assert.equal(lead.stage,'NEW');assert.equal(lead.ownerId,owner.id);assert.equal(lead.serviceCase?.service,service);
    assert.notEqual(lead.customerId,original.id);assert.equal((await prisma.customer.findUniqueOrThrow({where:{id:lead.customerId}})).status,'LEAD');
    assert.match(lead.notes??'',/UNVERIFIED/);assert(!/PER_PERSON|budgetRupees|budgetBasis|10000/.test(lead.notes??''),'Structured budget does not leak through unrestricted notes');assert.equal(lead.budgetMinor,0,'Per-person budget is not silently stored as total');
    const restricted={...lead,...projectSalesBudget(lead,false)};assert.equal(restricted.budgetMinor,null);assert.equal(restricted.requestedBudget,null);assert(!JSON.stringify(restricted).includes('10000'));
    const financial=projectSalesBudget(lead,true);assert.equal(financial.budgetMinor,null);assert.deepEqual(financial.requestedBudget,{amountRupees:10000,basis:'PER_PERSON'});assert.equal(financial.requestedBudgetJson,undefined);
    const replay=await send(input);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),receipt);
    const collision=structuredClone(input);collision.payload.draft.destination='Changed destination';assert.equal((await send(collision)).status,409);
    const newEnvelope={...input,eventId:randomUUID()};assert.equal((await send(newEnvelope)).status,409,'A new immutable-event identity cannot acknowledge changed or ignored content');
  }
  assert.equal(await prisma.salesLead.count(),4);assert.equal(await prisma.serviceCase.count(),4);assert.equal(await prisma.customer.count(),5);assert.equal(await prisma.booking.count(),0);assert.equal(await prisma.visaCase.count(),0);
  assert.equal((await prisma.customer.findUniqueOrThrow({where:{id:original.id}})).name,'Private existing customer');
  const unsigned=event('VISA');assert.equal((await send(unsigned,{signature:'0'.repeat(64)})).status,401);
  assert.equal((await send(unsigned,{timestamp:'1'})).status,401);
  const injected=event('CRUISE');const raw=JSON.stringify({...injected,payload:{...injected.payload,contactVerified:true}});assert.equal((await send(injected,{raw})).status,400);
  const mismatch=event('VISA');mismatch.aggregateId=randomUUID();assert.equal((await send(mismatch)).status,400);
  delete process.env.BOOKING_PLATFORM_OWNER_ID;assert.equal((await send(event('HOLIDAY'))).status,503);assert.equal(await prisma.salesLead.count(),4);
  const session={id:owner.id,name:owner.name,email:owner.email,role:'OWNER' as const,roleName:'Owner',branchId:branch.id,branchName:branch.name,employeeCode:owner.employeeCode,accessMode:'ALL' as const,permissions:ROLE_PERMISSIONS.OWNER};
  const page=await salesLeadPage(prisma,session,{q:'MAX_AI_WEBSITE',stage:'NEW'});assert.equal(page.leads.length,4,'Imported enquiries appear in the native CRM sales register');
  for(const service of ['VISA','HOLIDAY','CRUISE'])assert.equal(canConvertSalesProduct(service),false,'Enquiry approval must not invent unsupported fulfilment');
  assert.equal(canConvertSalesProduct('INSURANCE'),true);
  for(const service of ['VISA','INSURANCE'] as const){const childOnly=event(service);childOnly.payload.draft.adults=0;childOnly.payload.draft.childAges=[6];if(service==='INSURANCE')childOnly.payload.draft.travellerAges=[6];assert.equal(platformEnquirySchema.safeParse(childOnly).success,true,'Guardian may enquire for a child-only visa or insurance application');}
  assert.equal(projectSalesBudget({source:'MAX_AI_WEBSITE',budgetMinor:0,requestedBudgetJson:null},true).budgetMinor,null,'Missing budget never appears as a zero quote');
  assert.deepEqual(projectSalesBudget({source:'MAX_AI_WEBSITE',budgetMinor:0,requestedBudgetJson:JSON.stringify({amountRupees:100000000,basis:'TOTAL'})},true).requestedBudget,{amountRupees:100000000,basis:'TOTAL'},'Large budgets retain units without database integer overflow');
  console.log('CRM enquiry integration passed: four signed service imports, native sales visibility, replay, altered payload, signature/timestamp/identity checks, unverified-contact isolation, owner failure and no booking/application creation.');
}finally{
  await prisma.$disconnect();
  assert(path.resolve(directory).startsWith(prefix));rmSync(directory,{recursive:true,force:true});
}
