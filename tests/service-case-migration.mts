import assert from "node:assert/strict";
import {mkdir,mkdtemp,cp,writeFile,readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {PrismaClient} from "@prisma/client";
import {createServiceCase} from "../src/lib/service-cases";
await mkdir("tests/.runtime",{recursive:true});const dir=await mkdtemp(path.resolve("tests/.runtime/service-case-migration-"));const url=`file:${path.join(dir,"fixture.db").replaceAll("\\","/")}`;
await writeFile(path.join(dir,"fixture.db"),"");await writeFile(path.join(dir,"schema.prisma"),await readFile("prisma/schema.prisma"));await mkdir(path.join(dir,"migrations"));await cp("prisma/migrations/migration_lock.toml",path.join(dir,"migrations/migration_lock.toml"));
const latest="20261030110000_service_cases";for(const name of await readdir("prisma/migrations")){if(name!==latest&&name!=="migration_lock.toml")await cp(path.join("prisma/migrations",name),path.join(dir,"migrations",name),{recursive:true});}
const migrate=()=>execFileSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy","--schema",path.join(dir,"schema.prisma")],{env:{...process.env,DATABASE_URL:url},stdio:"pipe"});migrate();
const db=new PrismaClient({datasources:{db:{url}}});
try{
 await db.$executeRaw`INSERT INTO Role(id,key,name,desc) VALUES('role','OWNER','Owner','Fixture')`;
 await db.$executeRaw`INSERT INTO Branch(id,name,code,city) VALUES('branch','Fixture','FIX','Pune')`;
 await db.$executeRaw`INSERT INTO User(id,employeeCode,name,email,phone,passwordHash,roleId,branchId) VALUES('staff','EMP-FIX','Fixture Staff','staff@migration.test','','not-a-login','role','branch')`;
 await db.$executeRaw`INSERT INTO Customer(id,code,name,phone,city,branchId,assignedToId) VALUES('client','C-FIX','Fixture Client','','Pune','branch','staff')`;
 await db.$executeRaw`INSERT INTO SalesLead(id,customerId,branchId,ownerId,title,source,updatedAt) VALUES('lead','client','branch','staff','Flight request','Walk-in',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO Booking(id,bookingNo,customerId,ownerId,branchId,updatedAt) VALUES('original','BK-OLD','client','staff','branch',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO Booking(id,bookingNo,customerId,ownerId,branchId,reissueOfId,updatedAt) VALUES('reissue','BK-REISSUE','client','staff','branch','original',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO Booking(id,bookingNo,customerId,ownerId,branchId,product,updatedAt) VALUES('hotel','BK-HOTEL','client','staff','branch','HOTEL',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO SalesQuote(id,leadId,version,items,terms,totalMinor,costMinor,expiresAt,state,bookingId,createdBy) VALUES('quote','lead',1,'[]','Fixture',10000,8000,CURRENT_TIMESTAMP,'ACCEPTED','original','staff')`;
 await db.$executeRaw`INSERT INTO VisaStage(id,key,name,seq) VALUES('stage','ENQUIRY','Enquiry',1)`;
 await db.$executeRaw`INSERT INTO VisaCase(id,caseNo,customerId,stageId,visaType,destination,ownerId,branchId,updatedAt) VALUES('visa','VC-OLD','client','stage','Visitor','UK','staff','branch',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO AuditLog(id,userId,action,entity,entityId,detail) VALUES('old-audit','staff','UPDATE','Booking','original','Sensitive historical raw detail is not copied')`;
 await db.$disconnect();await cp(path.join("prisma/migrations",latest),path.join(dir,"migrations",latest),{recursive:true});migrate();
 const [lead,original,reissue,hotel,visa]=await Promise.all([db.salesLead.findUniqueOrThrow({where:{id:"lead"}}),db.booking.findUniqueOrThrow({where:{id:"original"}}),db.booking.findUniqueOrThrow({where:{id:"reissue"}}),db.booking.findUniqueOrThrow({where:{id:"hotel"}}),db.visaCase.findUniqueOrThrow({where:{id:"visa"}})]);
 assert(lead.serviceCaseId);assert.equal(original.serviceCaseId,lead.serviceCaseId);assert.equal(reissue.serviceCaseId,lead.serviceCaseId);assert.notEqual(hotel.serviceCaseId,lead.serviceCaseId);assert.notEqual(visa.serviceCaseId,lead.serviceCaseId);assert.equal(await db.serviceCase.count(),3);
 assert.equal(original.bookingNo,"BK-OLD");assert.equal(visa.caseNo,"VC-OLD");assert.equal(await db.ticket.count(),0);assert.equal(await db.payment.count(),0);
 const historic=await db.serviceCaseEvent.findUniqueOrThrow({where:{id:"historic-old-audit"}});assert.equal(historic.caseId,lead.serviceCaseId);assert(!historic.summary.includes("Sensitive"));assert.equal(historic.permission,"ticketing:view");
 const next=await db.$transaction(tx=>createServiceCase(tx,{customerId:"client",branchId:"branch",ownerId:"staff",service:"VISA",title:"New request"},"staff"));assert(next.caseNo.endsWith("0004"));assert.equal(await db.serviceCase.count(),4);
 assert.deepEqual(await db.$queryRawUnsafe('PRAGMA foreign_key_check'),[]);migrate();assert.equal(await db.serviceCase.count(),4,"Migration is not reapplied or renumbered");
 console.log("PASS service-case migration: historical identities, quote/reissue continuity, retained references/history, counter continuation, foreign keys and repeat deployment.");
}finally{await db.$disconnect();}
