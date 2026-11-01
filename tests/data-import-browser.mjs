import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {runSyntheticJourney} from './synthetic-ui-journey-fixture.mjs';

process.env.CRM_DATA_ENCRYPTION_KEY=randomBytes(32).toString('hex');
await runSyntheticJourney('data-import',3486,async({base,db,session,capture,postResult,check,fixture,report})=>{
 const owner=await db.user.findUniqueOrThrow({where:{email:'review@visual.test'}}),role=await db.role.findUniqueOrThrow({where:{key:'VISA_EXECUTIVE'}});
 const staff=await db.user.create({data:{employeeCode:'IMPORT-DEMO',name:'Imported case reviewer',email:'import-reviewer@example.test',phone:'',passwordHash:owner.passwordHash,branchId:owner.branchId,roleId:role.id}});
 await db.settings.upsert({where:{key:'case.configuration'},create:{key:'case.configuration',value:JSON.stringify({referencePrefix:'CASE',defaultOwnerId:owner.id,followUpDays:2,requireResolvedWorkToClose:true})},update:{value:JSON.stringify({referencePrefix:'CASE',defaultOwnerId:owner.id,followUpDays:2,requireResolvedWorkToClose:true})}});
 const files=path.join(fixture.runtime,'import-files');fs.mkdirSync(files,{recursive:true});
 async function file(page,entity,filename,content){const p=path.join(files,filename);fs.writeFileSync(p,content);await page.getByLabel(entity+' file',{exact:true}).setInputFiles(p);await page.getByText(filename+' · 1 rows',{exact:true}).waitFor();}
 async function preview(page){await postResult(page,'/api/imports',()=>page.getByRole('button',{name:'Validate & preview import',exact:true}).click(),b=>b.action==='prepare');await page.getByRole('region',{name:'Import preview'}).count().catch(()=>{});await page.getByRole('heading',{name:'Review proposed changes',exact:true}).waitFor();}
 async function action(page,id,label,note){await page.goto(base+'/work?task='+id);const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:label,exact:true}).click();await dialog.locator('textarea[name="note"]').fill(note);await postResult(page,'/api/work/'+id,()=>dialog.getByRole('button',{name:'Save: '+label.toLowerCase(),exact:true}).click());await dialog.waitFor({state:'hidden'});}
 for(const width of[1440,390]){
  const{page,context}=await session(width);await page.goto(base+'/imports');await page.getByRole('heading',{name:'Client & case import',exact:true}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download Excel template',exact:true}).click();const download=await downloadPromise;assert((await download.path()));
  const source='Demo Import '+width;await page.getByLabel('Source name',{exact:true}).fill(source);
  const phone=width===1440?'919000000010':'919000000011';
  await file(page,'Clients','clients-'+width+'.csv',`externalId,name,phone,email\nC1,Demo Imported ${width},${phone},demo-${width}@example.test\n`);
  await file(page,'Cases','cases-'+width+'.csv',`externalId,clientRef,service,title,status,openedOn,legacyReference,legacyStage,ownerEmail,nextAction\nCASE1,C1,VISA,Existing visa ${width},Documents pending,2025-03-04,OLD-${width},Passport awaited,${staff.email},Review imported visa source\n`);
  await page.getByLabel('Case status Documents pending',{exact:true}).selectOption('WAITING_CUSTOMER');
  await file(page,'Travellers','travellers-'+width+'.csv',`externalId,clientRef,name,relation,dateOfBirth,passportNumber\nT1,C1,Demo Imported ${width},SELF,2000-01-15,SYNTHETIC${width}\n`);
  await preview(page);const prepared=await db.dataImportBatch.findFirstOrThrow({where:{source:source.toLowerCase()},orderBy:{createdAt:'desc'}});assert.equal(prepared.status,'READY');assert.equal(await db.customer.count({where:{name:'Demo Imported '+width}}),0);assert(!(await page.getByRole('main').innerText()).includes('SYNTHETIC'+width));await capture(page,'preview-'+width);
  if(width===390){
   let calls=0;const handler=async route=>{if(route.request().method()!=='POST'||route.request().postDataJSON().action!=='commit')return route.fallback();calls++;const r=await route.fetch();assert(r.ok());await route.abort('failed');};
   await page.route('**/api/imports',handler);await page.getByRole('button',{name:'Import reviewed clients & cases',exact:true}).click();await page.getByRole('button',{name:'Check saved batch status',exact:true}).waitFor();assert.equal(calls,1);await page.unroute('**/api/imports',handler);await page.reload();
  }else await postResult(page,'/api/imports',()=>page.getByRole('button',{name:'Import reviewed clients & cases',exact:true}).dblclick(),b=>b.action==='commit');
  await page.getByRole('heading',{name:'Import completed',exact:true}).waitFor();
  const imported=await db.customer.findFirstOrThrow({where:{name:'Demo Imported '+width}}),journey=await db.serviceCase.findFirstOrThrow({where:{customerId:imported.id}}),task=await db.task.findFirstOrThrow({where:{serviceCaseId:journey.id}});
  assert.equal(await db.customer.count({where:{name:imported.name}}),1);assert.equal(journey.ownerId,staff.id);assert.equal(journey.status,'WAITING_CUSTOMER');assert.equal(task.requiresReview,true);assert.equal(imported.whatsappOptIn,false);await capture(page,'result-'+width);
  await page.getByRole('link',{name:journey.caseNo+' · OLD-'+width,exact:true}).click();await page.getByRole('heading',{name:'Imported case history',exact:true}).waitFor();await page.getByText('Original stage: Passport awaited',{exact:true}).waitFor();await capture(page,'case-'+width);
  const staffContext=await context.browser().newContext({viewport:{width,height:900},timezoneId:'Asia/Kolkata'});await staffContext.route(url=>url.origin!==base,r=>{report.blocked.push({origin:new URL(r.request().url()).origin});return r.abort('blockedbyclient');});const login=await staffContext.request.post(base+'/api/auth/login',{data:{email:staff.email,password:'Review-Visual-2026!'}});assert(login.ok());const staffPage=await staffContext.newPage();staffPage.on('pageerror',e=>report.errors.push(e.message));await staffPage.goto(base+'/cases/'+journey.id);await staffPage.getByRole('heading',{name:journey.caseNo,exact:true}).waitFor();await action(staffPage,task.id,'Start work','Checked the imported source record.');await action(staffPage,task.id,'Submit for review','The imported references and next action have been reviewed.');await action(page,task.id,'Approve result','Reviewed the imported-case handoff.');assert.equal((await db.task.findUniqueOrThrow({where:{id:task.id}})).workState,'DONE');
  const denied=await staffContext.request.get(base+'/api/imports');assert.equal(denied.status(),403);await staffPage.goto(base+'/imports');assert(!staffPage.url().includes('/imports'));await staffContext.close();
  const usedUndo=await context.request.post(base+'/api/imports',{data:{action:'undo',id:prepared.id,confirm:'UNDO '+prepared.id}});assert.equal(usedUndo.status(),409);
  await page.goto(base+'/reports/work');await page.getByRole('heading',{level:1}).waitFor();await capture(page,'work-report-'+width);
  check(width+': CSV uploads, status mapping, private preview, '+(width===390?'lost acknowledgement and reload recovery':'double-click protection')+', permanent case/legacy history, delegated staff start/submission, separate approval, import access denial and used-record undo protection');
  // A genuinely unused client-only batch can be undone through the reviewed UI.
  await page.goto(base+'/imports');await page.getByLabel('Source name',{exact:true}).fill('Unused '+width);await file(page,'Clients','unused-'+width+'.csv',`externalId,name,phone\nUNDO1,Unused demo ${width},${width===1440?'919000000020':'919000000021'}\n`);await preview(page);const unused=await db.dataImportBatch.findFirstOrThrow({where:{source:'unused '+width},orderBy:{createdAt:'desc'}});await postResult(page,'/api/imports',()=>page.getByRole('button',{name:'Import reviewed clients & cases',exact:true}).click(),b=>b.action==='commit');await page.getByRole('heading',{name:'Import completed',exact:true}).waitFor();
  await page.getByRole('article').filter({hasText:'unused '+width}).getByRole('button',{name:'Review undo',exact:true}).click();await page.getByLabel('Undo confirmation',{exact:true}).fill('UNDO '+unused.id);await postResult(page,'/api/imports',()=>page.getByRole('button',{name:'Undo unused import',exact:true}).click(),b=>b.action==='undo');assert.equal(await db.customer.count({where:{name:'Unused demo '+width}}),0);await capture(page,'unused-undo-'+width);check(width+': reviewed unused import undo leaves prior records intact');
  await context.close();
 }
 const requests=await db.dataImportBatch.count({where:{status:'COMMITTED'}});assert(requests>=2);
});
