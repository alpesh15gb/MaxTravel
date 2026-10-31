import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {PrismaClient} from '@maxtravel/prisma-postgresql';
import {chromium} from './browser.mjs';

// Explicitly synthetic cloud data. Never point this fixture at a customer database.
assert(new URL(process.env.DATABASE_URL).pathname.endsWith('/maxtravel_crm_preview'),'An isolated preview database is required');
const base=process.env.PREVIEW_BASE_URL??'http://127.0.0.1:3416';
assert(/^http:\/\/127\.0\.0\.1:3416$|^https:\/\/maxtravel-crm-preview-[a-z0-9-]+\.vercel\.app$/.test(base),'Unexpected preview origin');
const out=path.resolve('test-artifacts/cloud-preview');fs.mkdirSync(out,{recursive:true});
const accessPath=path.resolve('test-artifacts/preview-access.json');
let access=fs.existsSync(accessPath)?JSON.parse(fs.readFileSync(accessPath,'utf8')):{password:randomBytes(24).toString('base64url')+'!7',owner:{email:'owner@maxtravel.example.test'},staff:{email:'staff@maxtravel.example.test'}};
const saveAccess=()=>fs.writeFileSync(accessPath,JSON.stringify(access,null,2));saveAccess();
function totp(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join(''),key=Buffer.from((bits.match(/.{8}/g)??[]).map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',key).update(counter).digest(),i=mac[19]&15;return String((mac.readUInt32BE(i)&0x7fffffff)%1000000).padStart(6,'0');}
const db=new PrismaClient(),browser=await chromium.launch({headless:true});
const report={checks:[],screens:[],errors:[]};
async function post(context,url,data){const r=await context.request.post(base+url,{data}),b=await r.json();assert(r.ok(),`${url}: ${r.status()} ${b.error??''}`);return b;}
async function session(person){const c=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'UTC'});if(process.env.PREVIEW_ACCESS_URL){const p=await c.newPage();await p.goto(process.env.PREVIEW_ACCESS_URL);await p.close();}let code;if(person.recovery?.length){code=person.recovery.shift();saveAccess();}else if(person.secret)code=totp(person.secret);await post(c,'/api/auth/login',{email:person.email,password:access.password,code});if(!person.secret){const enrol=await post(c,'/api/auth/security',{action:'enrol',password:access.password});person.secret=enrol.secret;saveAccess();const confirm=await post(c,'/api/auth/security',{action:'confirm',password:access.password,code:totp(person.secret)});person.recovery=confirm.recovery;saveAccess();}return c;}
try{
 const health=await fetch(base+'/api/health');if(!process.env.PREVIEW_ACCESS_URL)assert.equal(health.status,200);
 if(!(await db.user.count())){
  const c=await browser.newContext(),p=await c.newPage();if(process.env.PREVIEW_ACCESS_URL)await p.goto(process.env.PREVIEW_ACCESS_URL);await p.goto(base+'/setup');
  for(const [label,value] of [['Agency name','Max Travel · UX Preview'],['Head-office city','Ahmedabad'],['Full name','Preview Administrator'],['Work email',access.owner.email],['Create password',access.password]])await p.getByLabel(new RegExp("^"+label)).fill(value);
  await p.getByRole('button',{name:'Create my workspace'}).click();await p.waitForURL(/\/login/);await c.close();report.checks.push('First-run setup completed through the real UI');
 }
 const owner=await db.user.findUniqueOrThrow({where:{email:access.owner.email}}),role=await db.role.findUniqueOrThrow({where:{key:'VISA_EXECUTIVE'}});
 let staff=await db.user.findUnique({where:{email:access.staff.email}});if(!staff)staff=await db.user.create({data:{name:'Preview Visa Staff',employeeCode:'PREVIEW-STAFF',email:access.staff.email,phone:'',passwordHash:owner.passwordHash,roleId:role.id,branchId:owner.branchId}});
 const admin=await session(access.owner),worker=await session(access.staff);
 const customer=await post(admin,'/api/customers',{name:'Synthetic traveller · UX review',phone:'+12025550108',email:'traveller@example.test',city:'Ahmedabad'});
 const journey=await post(admin,'/api/cases',{requestKey:randomUUID(),customerId:(customer.customerId??customer.id),service:'VISA',title:'Synthetic family visa · cloud acceptance'});
 const service=await db.serviceWork.findFirstOrThrow({where:{caseId:journey.caseId,service:'VISA'}});
 const created=await post(admin,'/api/work',{requestKey:randomUUID(),caseId:journey.caseId,serviceWorkId:service.id,title:'Confirm traveller visa requirements',details:'Record the requirements and next agreed step.',ownerId:staff.id,dueAt:new Date(Date.now()+86400000).toISOString(),requiresReview:true,reviewerId:owner.id,resultType:'NOTE'});
 const taskId=created.taskId??created.id??(await db.task.findFirstOrThrow({where:{serviceCaseId:journey.caseId,title:'Confirm traveller visa requirements'}})).id;
 async function action(context,action,note){const t=await db.task.findUniqueOrThrow({where:{id:taskId}});return post(context,`/api/work/${taskId}`,{requestKey:randomUUID(),version:t.version,action,note});}
 await action(worker,'START','Started requirements review.');await action(worker,'SUBMIT','Confirmed the required documents and next appointment.');
 let task=await db.task.findUniqueOrThrow({where:{id:taskId}});assert.equal(task.workState,'REVIEW');
 const forbidden=await worker.request.post(base+`/api/work/${taskId}`,{data:{requestKey:randomUUID(),version:task.version,action:'APPROVE',note:'Self review must fail'}});assert([403,409].includes(forbidden.status()));
 await action(admin,'APPROVE','Reviewed the requirements and recorded outcome.');task=await db.task.findUniqueOrThrow({where:{id:taskId}});assert.equal(task.workState,'DONE');assert(task.reviewedAt);assert(await db.workEvent.count({where:{taskId,kind:'APPROVE'}}));
 report.checks.push('Real PostgreSQL: permanent case ID → admin assignment → staff submission → independent approval and immutable history');
 const invoicePayload={requestKey:randomUUID(),customerId:(customer.customerId??customer.id),amount:1000.25,description:'Synthetic operational invoice · cloud test',dueDate:new Date(Date.now()+86400000).toISOString(),documentKind:'OPERATIONAL'};
 const invoice=await post(admin,'/api/invoices',invoicePayload),replay=await post(admin,'/api/invoices',invoicePayload);assert.equal(invoice.invoiceId,replay.invoiceId);assert.equal((await db.invoice.findUniqueOrThrow({where:{id:invoice.invoiceId}})).amount,1000.25);report.checks.push('Real PostgreSQL financial transaction and exact-request replay create one invoice');
 const denied=await worker.request.post(base+'/api/settings/cases',{data:{referencePrefix:'NO'}});assert.equal(denied.status(),403);
 const cross=await admin.request.post(base+'/api/customers',{headers:{origin:'https://untrusted.example.test'},data:{name:'Forbidden',phone:'000'}});assert.equal(cross.status(),403);report.checks.push('Staff settings access and cross-site writes are denied');
 for(const [roleName,c,routes]of[['admin',admin,['/dashboard','/cases',`/cases/${journey.caseId}?tab=work`,'/work','/reports/work','/workspace/finance','/settings']],['staff',worker,['/dashboard','/cases',`/cases/${journey.caseId}?tab=work`,'/work','/reports/work']]]){
  const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));for(const width of[1440,390]){await p.setViewportSize({width,height:width===390?844:1000});for(const route of routes){const r=await p.goto(base+route,{waitUntil:'networkidle'});assert(r&&r.status()<400,`${roleName}: ${route}`);await p.getByRole('main').waitFor();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${roleName} ${width}: overflow ${route}`);const name=`${roleName}-${width}-${report.screens.length}.png`;await p.screenshot({path:path.join(out,name),fullPage:true,animations:'disabled'});report.screens.push({role:roleName,width,route,file:name});}}await p.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;report.caseNo=journey.caseNo;report.checks.push('Admin and staff pages fit desktop and phone without browser runtime errors');console.log(JSON.stringify({passed:true,checks:report.checks,screens:report.screens.length}));
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await db.$disconnect();}
