import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('bridge verifies effective Request/init cache rather than repairing it',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'package-bridge-unit-'));
 const keys=['TWO_APP_PACKAGE_FIXTURE','TWO_APP_CRM_ORIGIN','TWO_APP_BRIDGE_LOG'];
 const previous=keys.map(key=>process.env[key]);
 const original=globalThis.fetch;
 const forwarded=[];
 try{
  process.env.TWO_APP_PACKAGE_FIXTURE='loopback-only';
  process.env.TWO_APP_CRM_ORIGIN='http://127.0.0.1:12345';
  process.env.TWO_APP_BRIDGE_LOG=path.join(dir,'bridge.jsonl');
  globalThis.fetch=async(input,init)=>{forwarded.push(new Request(input,init));return new Response('{}');};
  await import('./two-app-package-fetch.mjs');
  const url='https://crm.maxtravel.in/api/public/travel-packages';
  await assert.rejects(fetch(url),/Unexpected outbound/);
  await assert.rejects(fetch(url,{cache:'force-cache'}),/Unexpected outbound/);
  const inherited=new Request(url,{cache:'no-store'});
  await assert.rejects(fetch(inherited,{cache:'default'}),/Unexpected outbound/);
  assert.equal(forwarded.length,0);
  await fetch(url,{cache:'no-store'});
  await fetch(inherited);
  await fetch(inherited,{cache:undefined});
  await fetch(new Request(url,{cache:'force-cache'}),{cache:'no-store'});
  assert.equal(forwarded.length,4);
  for(const request of forwarded){
   assert.equal(request.cache,'no-store');
   assert.equal(request.url,'http://127.0.0.1:12345/api/public/travel-packages');
  }
 }finally{
  globalThis.fetch=original;
  keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});
  rmSync(dir,{recursive:true,force:true});
 }
});
