// Disposable synthetic arithmetic, not tax advice or a claim of real accountant approval.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runSyntheticJourney} from './synthetic-ui-journey-fixture.mjs';
function csvRows(source){
 const rows=[],row=[];let field='',quoted=false;
 for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);rows.push([...row]);row.length=0;field='';}else field+=c;}
 if(field||row.length){row.push(field);rows.push(row);}return rows;
}
await runSyntheticJourney('admin-records-complete-journey',3402,async({base,out,db,fixture,session,capture,postResult,lostResponseRetry,check})=>{
 for(const width of [1440,390]){
  const {page,context}=await session(width),owner=await db.user.findUniqueOrThrow({where:{email:'review@visual.test'}});
  const title=`Synthetic audit, "quoted" task ${width}`;
  await page.goto(base+'/tasks');await page.getByRole('button',{name:'New task',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'New task',exact:true});await dialog.getByLabel('Task *',{exact:true}).fill(title);
  await dialog.getByRole('combobox',{name:'Owner',exact:true}).selectOption(owner.id);
  const created=await postResult(page,'/api/tasks',()=>dialog.getByRole('button',{name:'Create task',exact:true}).click());await dialog.waitFor({state:'hidden'});
  const task=await db.task.findUniqueOrThrow({where:{id:created.task.id}});assert.equal(task.title,title);
  await page.locator(`#task-${task.id}`).getByRole('link',{name:'Task record audit history',exact:true}).click();
  await page.getByRole('heading',{name:'Audit trail',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('entityId'),task.id);
  const events=await db.auditLog.findMany({where:{entity:'Task',entityId:task.id}});assert.equal(events.length,1);
  await page.getByLabel('Employee name, code or ID (system for external)',{exact:true}).fill(owner.employeeCode);
  await page.getByLabel('Action (e.g. CREATE, STAGE)',{exact:true}).fill('CREATE');
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(events[0].at);
  await page.getByLabel('From date (IST)',{exact:true}).fill(day);await page.getByLabel('To date (IST)',{exact:true}).fill(day);
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('actor')===owner.employeeCode&&u.searchParams.get('action')==='CREATE');
  assert.equal(await page.locator('tbody tr').count(),1);await page.locator('tbody').getByText(title,{exact:true}).waitFor();
  const downloadReady=page.waitForEvent('download');await page.getByRole('link',{name:'Export audit trail',exact:true}).click();const download=await downloadReady;
  const saved=path.join(out,`filtered-audit-${width}.csv`);await download.saveAs(saved);assert.equal(await download.failure(),null);
  const rows=csvRows(fs.readFileSync(saved,'utf8').replace(/^\uFEFF/,''));assert.deepEqual(rows[0],['at','user','action','entity','entityId','detail']);assert.equal(rows.length,2);
  assert.deepEqual(rows[1],[events[0].at.toISOString(),`${owner.name} (${owner.employeeCode})`,'CREATE','Task',task.id,events[0].detail]);
  assert.equal(await db.auditLog.count({where:{entity:'audit',action:'EXPORT',userId:owner.id}}),width===1440?1:2);
  await capture(page,`audit-filtered-${width}`);
  await page.getByLabel('Action (e.g. CREATE, STAGE)',{exact:true}).fill('NO_SUCH_SYNTHETIC_ACTION');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByText('No audit entries.',{exact:true}).waitFor();
  await page.goBack();await page.locator('tbody').getByText(title,{exact:true}).waitFor();
  await page.getByRole('link',{name:'Clear',exact:true}).click();await page.waitForURL('**/audit');assert.equal(await page.getByLabel('Exact record ID',{exact:true}).inputValue(),'');
  await page.goBack();await page.reload();await page.locator('tbody').getByText(title,{exact:true}).waitFor();assert.equal(await db.task.count({where:{id:task.id}}),1);
  check(`${width}: actual Task create→record history→actor/action/IST-date/exact-record filters→download CSV equals persisted timestamp/actor/action/quoted detail→empty filter→Back→Clear→Back/reload; one export audit and no repeated task`);

  await page.goto(base+'/settings');let form=page.locator('form').filter({has:page.getByRole('heading',{name:'Invoice & tax settings',exact:true})});
  const before=(await db.settings.findUnique({where:{key:'invoice.configuration'}}))?.value??null;
  await form.getByRole('combobox',{name:'Invoice options',exact:true}).selectOption('OPERATIONAL_AND_TAX');
  const issuer=`Synthetic Issuer ${width}`,profileName=`Synthetic profile ${width}`;
  await form.getByRole('textbox',{name:'Legal issuer name *',exact:true}).fill(issuer);
  await form.getByRole('textbox',{name:/^Issuer GSTIN/}).fill('00SYNTHETIC0000');
  await form.getByRole('textbox',{name:'Issuer address *',exact:true}).fill('Synthetic address, not a registered agency');
  await form.getByRole('textbox',{name:'Issuer state *',exact:true}).fill('Synthetic state');
  await form.getByRole('textbox',{name:'Default place of supply *',exact:true}).fill('Synthetic state');
  await form.getByRole('textbox',{name:'Document title',exact:true}).fill('Synthetic Tax Invoice');
  await form.getByRole('textbox',{name:'Footer / terms',exact:true}).fill('TEST ONLY — no actual tax document or payment');
  while(await form.getByRole('button',{name:/^Remove Synthetic profile/}).count())await form.getByRole('button',{name:/^Remove Synthetic profile/}).first().click();
  await form.getByRole('button',{name:'Add profile',exact:true}).click();
  await form.getByRole('textbox',{name:'Profile 1 name',exact:true}).fill(profileName);
  await form.getByRole('textbox',{name:'Tax label',exact:true}).fill('Synthetic levy A');
  await form.getByRole('spinbutton',{name:'Rate (%)',exact:true}).fill('5.25');
  await form.getByRole('button',{name:'Add a tax component',exact:true}).click();
  await form.getByRole('textbox',{name:'Tax label 2',exact:true}).fill('Synthetic levy B');
  await form.getByRole('spinbutton',{name:'Rate (%)',exact:true}).nth(1).fill('2.5');
  const approval=form.getByRole('checkbox',{name:/^I confirm the issuer details/});await approval.uncheck();
  const rejected=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/invoice-config'&&r.request().method()==='POST');
  await form.getByRole('button',{name:'Save invoice settings',exact:true}).click();assert.equal((await rejected).status(),400);await form.getByRole('alert').waitFor();
  assert.equal((await db.settings.findUnique({where:{key:'invoice.configuration'}}))?.value??null,before);assert.equal(await form.getByRole('textbox',{name:'Legal issuer name *',exact:true}).inputValue(),issuer);
  // Fixture-only acknowledgement enables arithmetic tests; never submitted to a deployed system.
  await approval.check();
  const fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic settings unavailable'})});await page.route('**/api/settings/invoice-config',fail);
  await form.getByRole('button',{name:'Save invoice settings',exact:true}).click();await form.getByRole('alert').filter({hasText:'Synthetic settings unavailable'}).waitFor();
  assert.equal((await db.settings.findUnique({where:{key:'invoice.configuration'}}))?.value??null,before);assert.equal(await form.getByRole('textbox',{name:'Profile 1 name',exact:true}).inputValue(),profileName);await page.unroute('**/api/settings/invoice-config',fail);
  await postResult(page,'/api/settings/invoice-config',()=>form.getByRole('button',{name:'Save invoice settings',exact:true}).click());await page.reload();
  const config=JSON.parse((await db.settings.findUniqueOrThrow({where:{key:'invoice.configuration'}})).value);assert.equal(config.issuerName,issuer);assert.deepEqual(config.profiles[0].components.map(c=>c.ratePercent),[5.25,2.5]);await capture(page,`tax-configuration-${width}`);
  await page.goto(base+'/payments');await page.getByRole('button',{name:'Create invoice',exact:true}).click();dialog=page.getByRole('dialog',{name:'Create an invoice',exact:true});
  await dialog.getByRole('combobox',{name:'01 / Customer *',exact:true}).selectOption(fixture.customerId);
  await dialog.getByRole('combobox',{name:'Invoice document',exact:true}).selectOption('TAX_INVOICE');
  await dialog.getByRole('combobox',{name:'Tax profile *',exact:true}).selectOption(config.profiles[0].id);
  await dialog.getByRole('textbox',{name:'Customer state *',exact:true}).fill('Synthetic buyer state');
  await dialog.getByLabel('03 / Pre-tax amount (INR) *',{exact:true}).fill('123.45');
  await dialog.getByRole('textbox',{name:'Description',exact:true}).fill(`Synthetic tax snapshot ${width}`);
  const retry=await lostResponseRetry(page,'/api/invoices',dialog.getByRole('button',{name:'Create invoice',exact:true}),dialog.getByRole('alert'));assert.equal(retry.original.invoiceId,retry.result.invoiceId);await dialog.waitFor({state:'hidden'});
  const invoice=await db.invoice.findUniqueOrThrow({where:{id:retry.result.invoiceId}}),snapshot=JSON.parse(invoice.taxSnapshot);
  assert.equal(invoice.documentKind,'TAX_INVOICE');assert.equal(invoice.amount,133.02);assert.equal(snapshot.subtotalMinor,12345);assert.deepEqual(snapshot.components.map(c=>c.amountMinor),[648,309]);assert.equal(snapshot.taxMinor,957);assert.equal(snapshot.totalMinor,13302);assert.equal(snapshot.issuer.name,issuer);assert.equal(await db.invoice.count({where:{description:`Synthetic tax snapshot ${width}`}}),1);
  await page.goto(base+'/settings');form=page.locator('form').filter({has:page.getByRole('heading',{name:'Invoice & tax settings',exact:true})});
  await form.getByRole('textbox',{name:'Legal issuer name *',exact:true}).fill(`${issuer} changed`);await form.getByRole('spinbutton',{name:'Rate (%)',exact:true}).first().fill('99');
  await postResult(page,'/api/settings/invoice-config',()=>form.getByRole('button',{name:'Save invoice settings',exact:true}).click());
  assert.equal((await db.invoice.findUniqueOrThrow({where:{id:invoice.id}})).taxSnapshot,invoice.taxSnapshot);
  await page.goto(base+`/payments/print?invoice=${invoice.id}`);await page.getByRole('heading',{name:'Synthetic Tax Invoice',exact:true}).waitFor();await page.getByText(issuer,{exact:true}).waitFor();assert.equal(await page.getByText(`${issuer} changed`,{exact:true}).count(),0);await capture(page,`frozen-tax-invoice-${width}`);
  await page.goto(base+'/payments');const row=page.locator(`[data-invoice-id="${invoice.id}"]:visible`);await row.getByRole('button',{name:'Issue credit note',exact:true}).click();dialog=page.getByRole('dialog',{name:'Issue a full credit note',exact:true});
  await dialog.getByRole('textbox',{name:'Reason for credit *',exact:true}).fill('Synthetic full cancellation before any collection');
  const credit=await postResult(page,'/api/invoices/credit-note',()=>dialog.getByRole('button',{name:'Issue credit note',exact:true}).dblclick());await dialog.waitFor({state:'hidden'});
  const note=await db.invoiceCreditNote.findUniqueOrThrow({where:{id:credit.creditNoteId}});assert.equal(note.taxSnapshot,invoice.taxSnapshot);assert.equal(note.amount,133.02);assert.equal(await db.invoiceCreditNote.count({where:{invoiceId:invoice.id}}),1);
  const entries=await db.financialEntry.findMany({where:{OR:[{sourceType:'Invoice',sourceId:invoice.id},{sourceType:'InvoiceCreditNote',sourceId:note.id}]}});assert.equal(entries.length,2);assert.equal(entries.reduce((sum,e)=>sum+e.amountMinor,0n),0n);
  await row.getByRole('link',{name:'Credit note',exact:true}).waitFor();const href=await row.getByRole('link',{name:'Credit note',exact:true}).getAttribute('href');await page.goto(base+href);await page.getByRole('heading',{name:'Credit note',exact:true}).waitFor();await page.getByText(issuer,{exact:true}).waitFor();await page.getByText('Synthetic levy A credit',{exact:true}).waitFor();await capture(page,`frozen-tax-credit-${width}`);
  check(`${width}: tax config approval rejection/503 retain input without mutation→save→real tax invoice lost-ack retry exactly once (12345+648+309=13302 minor units)→change issuer/rate→original print frozen→repeated full-credit submit preserves original snapshot and zero-net journal→credit print`);
  await context.close();
 }
});
