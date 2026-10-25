// Reproduce stale CSV-preview availability with delayed local File.text; never submit an import.
import assert from 'node:assert/strict';
import {runSyntheticJourney} from './synthetic-ui-journey-fixture.mjs';
await runSyntheticJourney('customer-import-race',3398,async({base,db,session,capture,postResult,report,check})=>{
 const failures=[];
 for(const width of [1440,390]){
  const {page,context}=await session(width);
  await page.addInitScript(()=>{const read=File.prototype.text;File.prototype.text=function(){if(this.name!=='delayed-replacement.csv')return read.call(this);return new Promise(resolve=>{window.releaseSyntheticCsv=()=>resolve(read.call(this));});};});
  await page.goto(base+'/customer-tools');const before=await db.customer.count();
  const csv=`name,phone\nSynthetic preview only ${width},+91960000${String(width).padStart(4,'0')}`;
  await page.getByRole('textbox',{name:'CSV content',exact:true}).fill(csv);
  await postResult(page,'/api/customers/import',()=>page.getByRole('button',{name:'Validate & preview',exact:true}).click());
  await page.getByText('1 valid rows · 0 contact duplicates',{exact:true}).waitFor();
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'delayed-replacement.csv',mimeType:'text/csv',buffer:Buffer.from(csv.replace('preview only','replacement only'))});
  await page.waitForFunction(()=>typeof window.releaseSyntheticCsv==='function');
  const importButton=page.getByRole('button',{name:'Import these customers',exact:true});
  const stalePending=await importButton.count()&&await importButton.isEnabled();
  await capture(page,`replacement-reading-${width}`);
  if(stalePending)failures.push(`${width}: previous file preview remains importable while replacement file read is pending`);
  await page.evaluate(()=>window.releaseSyntheticCsv());await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('replacement only'));
  await postResult(page,'/api/customers/import',()=>page.getByRole('button',{name:'Validate & preview',exact:true}).click());await page.getByText('1 valid rows · 0 contact duplicates',{exact:true}).waitFor();
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'oversized-replacement.csv',mimeType:'text/csv',buffer:Buffer.alloc(512001,65)});
  await page.locator('[role="alert"]:not(#__next-route-announcer__)').getByText('Use a CSV file up to 512 KB.',{exact:true}).waitFor();
  const staleRejected=await importButton.count()&&await importButton.isEnabled();await capture(page,`replacement-rejected-${width}`);
  if(staleRejected)failures.push(`${width}: rejected replacement file leaves previous preview importable`);
  // A response for an earlier CSV must not publish an actionable preview after the text changes.
  await page.reload();await page.getByRole('textbox',{name:'CSV content',exact:true}).fill(csv);
  let release,ready;const held=new Promise(resolve=>release=resolve),admitted=new Promise(resolve=>ready=resolve);
  const hold=async route=>{const response=await route.fetch();ready();await held;await route.fulfill({response});};
  await page.route('**/api/customers/import',hold);await page.getByRole('button',{name:'Validate & preview',exact:true}).click();await admitted;
  await page.getByRole('textbox',{name:'CSV content',exact:true}).fill(csv.replace('preview only','changed after request'));
  const completed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/customers/import'&&r.request().method()==='POST');release();await completed;await page.unroute('**/api/customers/import',hold);
  await page.getByRole('button',{name:'Validate & preview',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Validate & preview'&&!button.disabled));
  const staleResponse=await importButton.count()&&await importButton.isEnabled();await capture(page,`preview-response-obsolete-${width}`);
  if(staleResponse)failures.push(`${width}: obsolete preview response becomes importable after CSV text changes`);
  assert.equal(await db.customer.count(),before,'Race observation must not create customers');
  report.observations??=[];report.observations.push({width,stalePending:!!stalePending,staleRejected:!!staleRejected,staleResponse:!!staleResponse,customerWrites:0});check(`${width}: observed both replacement states without importing any file`);await context.close();
 }
 assert.deepEqual(failures,[],'CSV selection must synchronously invalidate previous preview before asynchronous reading or rejection');
});
