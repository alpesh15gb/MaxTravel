import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import type {SessionUser} from "../src/lib/session";
async function run() {
 const {changedFieldNames}=await import("../src/lib/audit-changes");
 assert.deepEqual(changedFieldNames({phone:"old",password:"secret"},{phone:"private",password:"new-secret",documentText:"private document"},["phone"]),["phone"]);
 assert.deepEqual(changedFieldNames({phone:"same"},{phone:"same"},["phone"]),[]);
 const dir=mkdtempSync(path.join(tmpdir(),"maxtravel-audit-"));
 process.env.DATABASE_URL=`file:${dir}/test.db`;
 process.env.JWT_SECRET="audit-fixture-not-production-0123456789";
 execFileSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env:process.env,stdio:"pipe"});
 const {prisma}=await import("../src/lib/db");
 const {auditFilters,auditWhere}=await import("../src/lib/audit-query");
 try {
 const a=await prisma.branch.create({data:{name:"A",code:"A",city:"Test"}}),b=await prisma.branch.create({data:{name:"B",code:"B",city:"Test"}});
 const role=await prisma.role.create({data:{key:"OWNER",name:"Owner",desc:"Fixture"}});
 const employee=await prisma.user.create({data:{name:"Audit Employee",employeeCode:"EMP-TEST",email:"audit@example.test",phone:"",passwordHash:"not-a-password",roleId:role.id,branchId:a.id}});
 const other=await prisma.user.create({data:{name:"Other",employeeCode:"EMP-OTHER",email:"other@example.test",phone:"",passwordHash:"not-a-password",roleId:role.id,branchId:b.id}});
 const ca=await prisma.customer.create({data:{code:"C-A",name:"A",phone:"",city:"",branchId:a.id,assignedToId:employee.id}}),cb=await prisma.customer.create({data:{code:"C-B",name:"B",phone:"",city:"",branchId:b.id,assignedToId:other.id}});
 const booking=await prisma.booking.create({data:{bookingNo:"BK-A",customerId:ca.id,branchId:a.id,ownerId:employee.id}});
 for(const [id,userId,entity,entityId,at] of [["a",employee.id,"Customer",ca.id,"2026-10-20T18:29:59.000Z"],["b",employee.id,"Customer",cb.id,"2026-10-20T12:00:00.000Z"],["c",other.id,"Customer",ca.id,"2026-10-20T18:30:00.000Z"],["d",null,"Customer",ca.id,"2026-10-20T12:00:00.000Z"],["e",employee.id,"Settings","global","2026-10-20T12:00:00.000Z"],["f",employee.id,"Booking",booking.id,"2026-10-20T12:00:00.000Z"]]) await prisma.auditLog.create({data:{id:id!,userId,entity:entity!,entityId,action:"EDIT",at:new Date(at!)}});
 const user={id:employee.id,branchId:a.id,accessMode:"BRANCH",role:"BRANCH_MANAGER"} as SessionUser;
 const ids=async(u:SessionUser,q="")=>(await prisma.auditLog.findMany({where:await auditWhere(prisma,u,auditFilters(new URLSearchParams(q))),orderBy:{id:"asc"}})).map(r=>r.id);
 assert.deepEqual(await ids(user),["a","c","d","f"],"Scope follows record, not employee branch");
 assert.deepEqual(await ids(user,"actor=EMP-TEST&from=2026-10-20&to=2026-10-20&recordType=Customer&action=EDIT"),["a"]);
 assert.deepEqual(await ids(user,"actor=system"),["d"]);
 assert.deepEqual(await ids(user,`entityId=${cb.id}`),[],"Explicit record filter cannot bypass scope");
 assert.deepEqual(await ids({...user,branchId:null}),[]);
 assert.deepEqual(await ids({...user,accessMode:"ASSIGNED"}),["a","c","d","f"]);
 assert.deepEqual(await ids({...user,accessMode:"ALL"}),["a","b","c","d","e","f"]);
 // Every newly linked list-row entity must resolve through the same record scope.
 for (const customer of [ca,cb]) {
   const suffix=customer.id;
   const doc=await prisma.document.create({data:{docNo:`DOC-${suffix}`,customerId:suffix,docType:"Synthetic"}});
   const task=await prisma.task.create({data:{title:"Synthetic",ownerId:customer.assignedToId!,branchId:customer.branchId}});
   const refund=await prisma.refund.create({data:{refundNo:`RF-${suffix}`,customerId:suffix,amount:1}});
   const invoice=await prisma.invoice.create({data:{invoiceNo:`INV-${suffix}`,customerId:suffix,amount:1}});
   const payment=await prisma.payment.create({data:{receiptNo:`RCP-${suffix}`,customerId:suffix,amount:1}});
   for (const [entity,record] of [["Document",doc],["Task",task],["Refund",refund],["Invoice",invoice],["Payment",payment]] as const) {
     const log=await prisma.auditLog.create({data:{entity,entityId:record.id,userId:employee.id,action:"CREATE"}});
     assert.deepEqual(await ids(user,`recordType=${entity}&entityId=${record.id}`),customer.id===ca.id?[log.id]:[],`${entity} history respects branch`);
     assert.deepEqual(await ids({...user,accessMode:"ASSIGNED"},`recordType=${entity}&entityId=${record.id}`),customer.id===ca.id?[log.id]:[],`${entity} history respects assignment`);
   }
 }
 for(const q of ["from=2026-02-30","from=bad","from=2026-10-21&to=2026-10-20"]) assert.throws(()=>auditFilters(new URLSearchParams(q)));
 for(const file of ["src/app/(app)/audit/page.tsx","src/app/api/export/route.ts","src/app/api/audit/route.ts"]) assert.match(readFileSync(file,"utf8"),/auditWhere\(prisma,\s*user,/ ,`${file} must use shared filters and scope`);
 console.log("Audit scenarios passed: cross-branch actor, scoped record, assigned/missing branch, system, inclusive dates, invalid filters, shared page/API/CSV query.");
 } finally {await prisma.$disconnect();rmSync(dir,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
