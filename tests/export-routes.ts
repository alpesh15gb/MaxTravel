/** Route contract tests with explicit in-memory dependencies; no database, session, or HTTP listener. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { csvDocument } from "../src/lib/csv-export";
import { indiaDay } from "../src/lib/report-workspace";

class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
let permissions=["export:data","payment:view"], count=5001, exports=0, lastQuery:any;
const payment={receiptNo:"RCP-000001",customer:{name:'  =HYPERLINK("bad")'},amount:-12.34,mode:"NEFT",receivedOn:new Date("2026-10-24T18:30:00.000Z")};
const scope={assignedToId:"permitted-staff"};
const dependencies:Record<string,unknown>={
 "@/lib/guard":{ApiError,requireSession:async(p:string)=>{if(!permissions.includes(p))throw new ApiError(403,"Denied");return {permissions,id:"permitted-staff",accessMode:"ASSIGNED"};},scopeWhere:()=>scope,jsonError:(e:ApiError)=>Response.json({error:e.message},{status:e.status||500})},
 "@/lib/db":{prisma:{payment:{findMany:async(query:unknown)=>{lastQuery=query;return Array.from({length:count},()=>payment);}},customer:{findMany:async()=>[]},booking:{findMany:async()=>[{bookingNo:"BK-001",pnr:"001234567890123456",customer:{name:"Synthetic"},airline:"Airline",sector:"A–B",status:"PNR_CREATED",travelDate:new Date("2026-10-24T18:30:00Z"),sellingPrice:123.45,currency:"USD",owner:{name:"Owner"}}]},auditLog:{findMany:async(query:unknown)=>{lastQuery=query;return Array.from({length:count},()=>({at:new Date("2026-10-24T18:30:00Z"),user:null,action:"VIEW",entity:"Customer",detail:"Synthetic"}));}}}},
 "@/lib/rbac":{can:(perms:string[],p:string)=>perms.includes(p)},"@/lib/audit":{audit:async()=>{exports++;}},
 "@/lib/audit-query":{auditFilters:()=>({action:"VIEW"}),auditWhere:async()=>({AND:[scope,{action:"VIEW"}]})},
 "@/lib/invoice-config":{readInvoiceTaxSnapshot:()=>null},"@/lib/receivables":{balanceOf:(a:number,b:number)=>Math.max(0,a-b)},
 "@/lib/csv-export":{csvDocument},"@/lib/report-workspace":{indiaDay},
};
function loadRoute(file:string){
 const output=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {GET:(req:Request)=>Promise<Response>}};
 vm.runInNewContext(output,{exports:module.exports,module,require:(id:string)=>{assert(id in dependencies,`Unexpected dependency ${id}`);return dependencies[id];},Response,Request,URL,URLSearchParams,Date,Uint8Array},{filename:file});
 return module.exports.GET;
}
async function run(){
 const GET=loadRoute("src/app/api/export/route.ts");
 let response=await GET(new Request("https://example.test/api/export?entity=payments"));assert.equal(response.status,200);let text=await response.text();
 assert.equal(response.headers.get("X-Export-Row-Count"),"5001");assert.equal(text.split("\r\n").length,5003);assert(text.includes('"-12.34"'));assert(text.includes('"2026-10-25"'));assert(text.includes('"\'  =HYPERLINK'));assert.equal(response.headers.get("Cache-Control"),"no-store");assert.deepEqual(lastQuery.where.customer.is,scope);assert.equal(lastQuery.take,50001);assert.equal(exports,1);
 count=50001;response=await GET(new Request("https://example.test/api/export?entity=payments"));assert.equal(response.status,422);assert((await response.text()).includes("Receipts & refunds"));assert.equal(exports,1);
 permissions=["export:data","audit:view"];response=await GET(new Request("https://example.test/api/export?entity=audit&action=VIEW"));assert.equal(response.status,422);assert((await response.text()).includes("Narrow the date"));assert.equal(exports,1);
 count=1;response=await GET(new Request("https://example.test/api/export?entity=audit"));assert.equal(response.status,200);assert((await response.text()).includes("2026-10-24T18:30:00.000Z"));assert.equal(lastQuery.where.AND[0],scope);
 permissions=["export:data","customer:view"];response=await GET(new Request("https://example.test/api/export?entity=customers"));assert.equal(response.status,200);text=await response.text();assert(text.includes('"code","name","type","phone"'));assert(!text.includes("no data"));
 permissions=["export:data","ticketing:view"];response=await GET(new Request("https://example.test/api/export?entity=ticketing"));text=await response.text();assert(!text.includes("sellingPrice"));assert(!text.includes("currency"));assert(!text.includes("123.45"));
 permissions.push("payment:view");response=await GET(new Request("https://example.test/api/export?entity=ticketing"));text=await response.text();assert(text.includes('"sellingPrice","currency"'));assert(text.includes('"123.45","USD"'));assert(!text.includes("supplierCost"));
 permissions=["export:data","payment:view"];count=50000;response=await GET(new Request("https://example.test/api/export?entity=payments"));assert.equal(response.status,200);assert.equal(response.headers.get("X-Export-Row-Count"),"50000");assert.equal((await response.text()).split("\r\n").length,50002);
 permissions=["export:data"];response=await GET(new Request("https://example.test/api/export?entity=payments"));assert.equal(response.status,403);
 permissions=[];response=await GET(new Request("https://example.test/api/export?entity=customers"));assert.equal(response.status,403);
 console.log("Export route contracts passed: 5,001 complete rows; bounded 50,001 refusal with narrowing guidance; scoped query; permission denial; empty headers; no hidden money; booking currency; India dates; UTC audit; CSV safety.");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
