import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {within} from './fixture-lifecycle.mjs';
import {runSyntheticJourney} from './synthetic-ui-journey-fixture.mjs';
const baseline=process.env.SUPPLIER_REFRESH_BASELINE==='1';
await runSyntheticJourney(`supplier-refresh-${baseline?'baseline':'fixed'}`,3404,async({base,db,report,session,postResult,capture,check})=>{
 report.source={mode:baseline?'expected-stale-baseline-reproduction':'fixed-regression',supplierBlob:execFileSync('git',['hash-object','src/app/(app)/suppliers/SuppliersClient.tsx'],{encoding:'utf8'}).trim(),candidateCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
 for(const width of [1440,390]){
  const {page,context}=await session(width);await page.goto(base+'/suppliers');
  await page.getByRole('button',{name:'New supplier',exact:true}).click();let dialog=page.getByRole('dialog',{name:'New supplier',exact:true});const name=`Synthetic refresh supplier ${width}`;
  await dialog.getByLabel('Supplier name *',{exact:true}).fill(name);await postResult(page,'/api/suppliers',()=>dialog.getByRole('button',{name:'Save',exact:true}).click());await dialog.waitFor({state:'hidden'});
  const supplier=await db.supplier.findUniqueOrThrow({where:{name}});await page.getByRole('heading',{name,exact:true}).waitFor();
  await page.getByRole('button',{name:'Add payable',exact:true}).click();dialog=page.getByRole('dialog',{name:'New payable',exact:true});await dialog.getByRole('combobox',{name:'Supplier *',exact:true}).selectOption(supplier.id);await dialog.getByLabel('Description *',{exact:true}).fill(`Synthetic refresh payable ${width}`);await dialog.getByLabel('Amount (INR) *',{exact:true}).fill('250.50');await dialog.getByLabel('Due date *',{exact:true}).fill('2099-11-01');await postResult(page,'/api/suppliers/dues',()=>dialog.getByRole('button',{name:'Save',exact:true}).click());await dialog.waitFor({state:'hidden'});
  const due=await db.supplierDue.findFirstOrThrow({where:{supplierId:supplier.id}}),card=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  // Hold only the real post-write RSC read. API writes still commit normally.
  async function holdRefresh(){
   let release,seen;const gate=new Promise(r=>release=r),started=new Promise(r=>seen=r);let held=0,expectReloadCancellation=false;const completions=[];
   const handler=async route=>{
    if(route.request().method()!=='GET'||new URL(route.request().url()).origin!==base||new URL(route.request().url()).pathname!=='/suppliers'||route.request().headers().rsc!=='1')return route.fallback();
    const completed=(async()=>{held++;seen();await gate;try{await route.continue();}catch(error){
     if(expectReloadCancellation&&/Target page, context or browser has been closed|Invalid InterceptionId|No resource with given identifier|Route is already handled|Request.*(cancel|abort)/i.test(String(error))){
      (report.expectedReloadCancellations??=[]).push({width,error:String(error)});
     }else throw error;
    }})();completions.push(completed);await completed;
   };
   await page.route('**/suppliers?*',handler);
   return {started:()=>within(started,10000,'post-write supplier RSC read must start'),expectReload:()=>{expectReloadCancellation=true;},release:async()=>{release();await within(Promise.all(completions),10000,'held supplier read continuation');await page.unroute('**/suppliers?*',handler);},count:()=>held};
  }
  await card.getByRole('button',{name:'Record payment',exact:true}).click();dialog=page.getByRole('dialog',{name:'Record a supplier payment',exact:true});await dialog.getByRole('spinbutton',{name:/^Amount \(INR\)/}).fill('100.25');
  const partialHold=await holdRefresh();await postResult(page,'/api/suppliers/dues',()=>dialog.getByRole('button',{name:'Record payment',exact:true}).click());await dialog.waitFor({state:'hidden'});await partialHold.started();
  assert.equal((await db.supplierDue.findUniqueOrThrow({where:{id:due.id}})).paidAmount,100.25);
  if(!baseline){assert(await card.getByRole('button',{name:'Record payment',exact:true}).isDisabled());assert(await card.getByRole('button',{name:'Edit',exact:true}).isDisabled());await page.getByRole('button',{name:'Reload balances',exact:true}).waitFor();await capture(page,`partial-refresh-locked-${width}`);}
  await partialHold.release();await card.getByText('Payment history (1)',{exact:true}).click();await card.getByRole('button',{name:'Reverse',exact:true}).waitFor();
  // Locator click waits until reconciliation re-enables the actual Reverse action.
  await card.getByRole('button',{name:'Reverse',exact:true}).click();dialog=page.getByRole('dialog',{name:'Reverse supplier settlement',exact:true});await dialog.getByRole('textbox',{name:'Reason for reversal *',exact:true}).fill('Synthetic correction before resettlement');
  const reversalHold=await holdRefresh();await postResult(page,'/api/suppliers/dues',()=>dialog.getByRole('button',{name:'Reverse settlement',exact:true}).click());await dialog.waitFor({state:'hidden'});await reversalHold.started();
  const reversed=await db.supplierDue.findUniqueOrThrow({where:{id:due.id}});assert.equal(reversed.paidAmount,0);const original=await db.supplierSettlement.findFirstOrThrow({where:{dueId:due.id}});assert(original.reversedOn);
  if(baseline){
   assert.equal(await card.getByRole('button',{name:'Record payment',exact:true}).isDisabled(),false);
   await card.getByRole('button',{name:'Record payment',exact:true}).click();dialog=page.getByRole('dialog',{name:'Record a supplier payment',exact:true});
   assert.equal(await dialog.getByRole('spinbutton',{name:/^Amount \(INR\)/}).inputValue(),'150.25','Old Due remains captured despite the acknowledged reversal to zero paid');
   await capture(page,`confirmed-stale-default-${width}`);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await reversalHold.release();
   check(`${width}: baseline real partial settlement/reversal acknowledged with DB paid0, held refresh leaves money action enabled and next dialog incorrectly defaults150.25 instead of250.50; cancelled without another write`);
  }else{
   assert(await card.getByRole('button',{name:'Record payment',exact:true}).isDisabled());assert(await card.getByRole('button',{name:'Reverse',exact:true}).isDisabled());
   await page.getByRole('button',{name:'Reload balances',exact:true}).waitFor();await capture(page,`reversal-refresh-locked-${width}`);
   assert.equal(await db.supplierSettlement.count({where:{dueId:due.id}}),1);
   if(width===390){
    // A user can recover without waiting forever for the background refresh.
    reversalHold.expectReload();const navigated=page.waitForNavigation({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Reload balances',exact:true}).click();await navigated;await reversalHold.release();
   }else await reversalHold.release();
   await card.getByRole('button',{name:'Record payment',exact:true}).click();dialog=page.getByRole('dialog',{name:'Record a supplier payment',exact:true});assert.equal(await dialog.getByRole('spinbutton',{name:/^Amount \(INR\)/}).inputValue(),'250.5');
   await postResult(page,'/api/suppliers/dues',()=>dialog.getByRole('button',{name:'Record payment',exact:true}).dblclick());await dialog.waitFor({state:'hidden'});await page.reload();
   const settled=await db.supplierDue.findUniqueOrThrow({where:{id:due.id}});assert.equal(settled.paidAmount,250.5);assert.equal(settled.paid,true);assert.equal(await db.supplierSettlement.count({where:{dueId:due.id}}),2);assert.equal((await db.supplierSettlement.findUniqueOrThrow({where:{id:original.id}})).reversalReason,'Synthetic correction before resettlement');
   await card.getByText('Paid history (1)',{exact:true}).click();await capture(page,`correct-resettlement-${width}`);check(`${width}: held partial and reversal refresh disable stale money/edit actions; ${width===390?'explicit reload recovery':'authoritative refresh reconciliation'} opens250.50 default→doubleclick full settlement exactly once; original reversal history retained`);
  }
  await context.close();
 }
});
