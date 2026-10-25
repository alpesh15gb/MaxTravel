// Real commit with a lost acknowledgement: freeze CSV and consolidation until same-ID retry resolves.
import assert from 'node:assert/strict';
import {runSyntheticJourney} from './synthetic-ui-journey-fixture.mjs';
await runSyntheticJourney('customer-import-pending',3399,async({base,db,session,capture,postResult,check})=>{
 for(const width of [1440,390]){
  const {page,context}=await session(width);await page.goto(base+'/customer-tools');
  const name=`Synthetic pending import ${width}`,csv=`name,phone\n${name},+91950000${String(width).padStart(4,'0')}`;
  await page.getByRole('textbox',{name:'CSV content',exact:true}).fill(csv);await postResult(page,'/api/customers/import',()=>page.getByRole('button',{name:'Validate & preview',exact:true}).click());await page.getByText('1 valid rows · 0 contact duplicates',{exact:true}).waitFor();
  let payload,original,calls=0;
  const lose=async route=>{calls++;payload=route.request().postDataJSON();const response=await route.fetch();assert(response.ok());original=await response.json();await route.abort('failed');};
  await page.route('**/api/customers/import',lose);await page.getByRole('button',{name:'Import these customers',exact:true}).click();await page.getByRole('alert').waitFor();await page.unroute('**/api/customers/import',lose);
  assert.equal(calls,1);assert.equal(original.created,1);assert.equal(await db.customer.count({where:{name}}),1);
  const merge=page.getByRole('button',{name:'Consolidate selected profiles',exact:true});assert(await merge.isDisabled(),'Unknown import cannot navigate away through consolidation');assert(await page.getByRole('textbox',{name:'CSV content',exact:true}).isDisabled());assert(await page.getByLabel('CSV file',{exact:true}).isDisabled());
  await capture(page,`pending-import-merge-blocked-${width}`);
  const retry=await postResult(page,'/api/customers/import',()=>page.getByRole('button',{name:'Import these customers',exact:true}).click(),body=>{assert.deepEqual(body,payload,'Recovery must keep exact CSV/branch/requestId');return true;});assert.equal(retry.replayed,true);assert.equal(await db.customer.count({where:{name}}),1);
  await page.getByRole('status').getByText('Imported 1 customers. Automatic WhatsApp consent is off for imported records.',{exact:true}).waitFor();assert(await merge.isEnabled(),'Confirmed import releases consolidation');assert(await page.getByRole('textbox',{name:'CSV content',exact:true}).isEnabled());await capture(page,`recovered-import-merge-enabled-${width}`);check(`${width}: committed import loses response→CSV and merge locked→identical payload retry recovers once→merge and draft editable`);await context.close();
 }
});
