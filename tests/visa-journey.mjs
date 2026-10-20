// Isolated API + browser regression of intake, requirements, stage retries and appointment editing.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,createWriteStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {chromium} from './browser.mjs';
const root=process.cwd(),runtime=path.join(root,'tests','.runtime',`visa-journey-${Date.now()}`);mkdirSync(runtime,{recursive:true});
const origin='http://127.0.0.1:3223',database=`file:${path.join(runtime,'test.db')}`;
const env={...process.env,DATABASE_URL:database,JWT_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,WA_PROVIDER:'manual',NEXT_DIST_DIR:process.env.VISA_TEST_DEV?'tests/.runtime/visa-next-dev':process.env.NEXT_DIST_DIR??'.next'};
execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,stdio:'pipe'});
const prisma=new PrismaClient({datasources:{db:{url:database}}});
const log=createWriteStream(path.join(runtime,'server.log'));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next',process.env.VISA_TEST_DEV?'dev':'start','-p','3223','-H','127.0.0.1'],{env,stdio:['ignore','pipe','pipe']});server.stdout.pipe(log);server.stderr.pipe(log);
let browser;const password=`Visa-${randomBytes(18).toString('hex')}!`;let cookie='';
async function post(url,body,status=200){const r=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,status,`${url}: ${JSON.stringify(data)}`);return {data,r};}
try{
 let ready=false;for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error('Server stopped');try{if((await fetch(origin+'/setup')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert(ready);
 await post('/api/setup',{agencyName:'Synthetic visa journey',city:'Test',name:'Journey owner',email:'owner@journey.test',password},201);
 const login=await post('/api/auth/login',{email:'owner@journey.test',password});cookie=login.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const customer=(await post('/api/customers',{name:'Synthetic family',phone:'+919000000121'})).data;
 const first=await prisma.traveller.findFirstOrThrow({where:{customerId:customer.id}});await prisma.traveller.update({where:{id:first.id},data:{fullName:'Same Name',dateOfBirth:new Date('2010-01-01')}});
 const second=(await post('/api/travellers',{customerId:customer.id,fullName:'Same Name',dateOfBirth:'1990-01-01'})).data.travellerId;
 const missing=(await post('/api/travellers',{customerId:customer.id,fullName:'DOB not known'})).data.travellerId;
 const checklist=await prisma.checklist.create({data:{country:'Journeyland',visaType:'Tourist',applicantType:'STANDARD',items:{create:[{name:'Adult evidence',travellerType:'ADULT'},{name:'Minor evidence',travellerType:'MINOR'}]}}});
 const empty=await prisma.checklist.create({data:{country:'Journeyland',visaType:'Tourist',applicantType:'EXEMPT'}});
 const base={customerId:customer.id,destination:'Journeyland',visaType:'Tourist',travellerIds:[first.id],travelDate:'2029-01-01'};
 await post('/api/visa/cases',{...base,destination:'Wrongland',checklistId:checklist.id},400);
 await post('/api/visa/cases',{...base,travellerIds:[missing],checklistId:checklist.id},400);
 const intake=(await post('/api/visa/cases',{...base,checklistId:checklist.id})).data;let docs=await prisma.document.findMany({where:{visaCaseId:intake.caseId}});assert.deepEqual(docs.map(d=>d.docType),['Adult evidence'],'Age is evaluated at travel date');
 const noChecklist=(await post('/api/visa/cases',{...base,travellerIds:[missing]})).data;
 const stages=Object.fromEntries((await prisma.visaStage.findMany()).map(s=>[s.key,s.id]));
 await post(`/api/visa/cases/${noChecklist.caseId}/stage`,{stageId:stages.READY_FOR_SUBMISSION},400);
 await post('/api/visa/requirements',{caseId:noChecklist.caseId,travellerId:missing,checklistId:empty.id});
 await post(`/api/visa/cases/${noChecklist.caseId}/stage`,{stageId:stages.READY_FOR_SUBMISSION});
 await post(`/api/visa/cases/${noChecklist.caseId}/stage`,{stageId:stages.APPOINTMENT_BOOKED},400);
 const appointment='2029-01-05T09:45:00+05:30';await post(`/api/visa/cases/${noChecklist.caseId}/edit`,{appointmentDate:appointment});
 await post(`/api/visa/cases/${noChecklist.caseId}/stage`,{stageId:stages.APPOINTMENT_BOOKED});
 await post(`/api/visa/cases/${noChecklist.caseId}/stage`,{stageId:stages.APPROVED});
 const before=await prisma.visaCase.findUniqueOrThrow({where:{id:noChecklist.caseId}});const history=await prisma.visaCaseStatus.count({where:{caseId:noChecklist.caseId}});
 await post(`/api/visa/cases/${noChecklist.caseId}/stage`,{stageId:stages.APPROVED});assert.equal((await prisma.visaCase.findUniqueOrThrow({where:{id:noChecklist.caseId}})).decisionDate.toISOString(),before.decisionDate.toISOString());assert.equal(await prisma.visaCaseStatus.count({where:{caseId:noChecklist.caseId}}),history);
 const family=(await post('/api/visa/cases',{...base,travellerIds:[first.id,second],checklistId:empty.id})).data;
 await prisma.document.createMany({data:[{docNo:'SYNTHETIC-ONE',customerId:customer.id,visaCaseId:family.caseId,travellerId:first.id,docType:'First applicant evidence',status:'RECEIVED',storagePath:'uploads/synthetic-not-read.pdf'},{docNo:'SYNTHETIC-TWO',customerId:customer.id,visaCaseId:family.caseId,travellerId:second,docType:'Second applicant evidence'}]});
 console.log('PASS visa API: destination/type matching, age at travel, missing DOB, explicit exempt checklist, appointment prerequisite, idempotent decision retry');
 if (!process.env.VISA_TEST_API_ONLY) {
 mkdirSync('test-artifacts/journeys',{recursive:true});
 browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.addCookies(cookie.split('; ').map(c=>{const [name,...value]=c.split('=');return {name,value:value.join('='),url:origin};}));const page=await context.newPage();
 await page.goto(origin+`/visa/${family.caseId}`);await page.getByRole('heading',{name:'Documents & Checklist'}).waitFor();assert.equal(await page.getByText('First applicant evidence',{exact:true}).count(),1);assert.equal(await page.getByText('Second applicant evidence',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Reject',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await prisma.document.findUniqueOrThrow({where:{docNo:'SYNTHETIC-ONE'}})).status,'RECEIVED');await page.getByRole('button',{name:'Reject',exact:true}).click();await page.getByLabel('Reason for rejection',{exact:true}).fill('Photo is cropped; please include the full page.');await page.getByRole('button',{name:'Reject document',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await prisma.document.findUniqueOrThrow({where:{docNo:'SYNTHETIC-ONE'}})).rejectionReason,'Photo is cropped; please include the full page.');
 await page.goto(origin+`/visa/${noChecklist.caseId}`);await page.getByRole('button',{name:'Edit Case',exact:true}).click();assert.equal(await page.getByLabel('Appointment date & time (IST)',{exact:true}).inputValue(),'2029-01-05T09:45');await page.getByLabel('Internal notes',{exact:true}).fill('Appointment preserved while editing notes');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('heading',{name:`Edit ${noChecklist.caseNo}`}).waitFor({state:'hidden'});assert.equal((await prisma.visaCase.findUniqueOrThrow({where:{id:noChecklist.caseId}})).appointmentDate.toISOString(),new Date(appointment).toISOString());
 await page.screenshot({path:'test-artifacts/journeys/visa-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-artifacts/journeys/visa-phone.png',fullPage:true});
 console.log('PASS visa journey: checklist matching, exact age-at-travel, unknown DOB, explicit exempt checklist, appointment prerequisite + IST editing, decision retry, same-name applicant isolation');
 }
}finally{await browser?.close();server.kill('SIGTERM');await prisma.$disconnect();log.end();}
