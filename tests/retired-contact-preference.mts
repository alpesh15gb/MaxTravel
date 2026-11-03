import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import type {SessionUser} from "../src/lib/session";
import {readMaster} from "../src/lib/customer-master";
import {seal} from "../src/lib/staff-security";
const previous=process.env.CRM_DATA_ENCRYPTION_KEY;
process.env.CRM_DATA_ENCRYPTION_KEY=randomBytes(32).toString("hex");
const user:SessionUser={id:"staff",name:"Test",email:"staff@example.test",role:"OWNER",roleName:"Owner",branchId:"branch",branchName:"Test",employeeCode:"TEST",accessMode:"ALL",permissions:["customer:view"]};
let raw:string|null=null;
const db={customer:{findUnique:async()=>({id:"customer",name:"Test customer",code:"TEST-C",type:"INDIVIDUAL",phone:"",email:"customer@example.test",city:"",address:null,companyName:null,gstNumber:null,status:"ACTIVE",profileData:raw,assignedTo:null,branchId:"branch",branch:{name:"Test branch"},travellers:[],documents:[]})},auditLog:{findMany:async()=>[]}} as unknown as PrismaClient;
try{
 for(const [before,after]of[["WHATSAPP","EMAIL"],["CALL","CALL"],["EMAIL","EMAIL"],["",""]]as const){
  raw=seal(JSON.stringify({contactMethod:before,contactInstructions:"Contact in the afternoon",source:"REFERRAL"}),"customer-master:customer");
  const stored=raw,result=await readMaster(db,user,"customer");
  assert.equal(result.customer.details.contactMethod,after);
  assert.equal(result.customer.details.contactInstructions,"Contact in the afternoon");
  assert.equal(result.customer.details.source,"REFERRAL");
  assert.equal(raw,stored,"read normalization must not rewrite or discard encrypted profile data");
 }
 const stored=raw;process.env.CRM_DATA_ENCRYPTION_KEY=randomBytes(32).toString("hex");
 await assert.rejects(()=>readMaster(db,user,"customer"),/original encryption key/);
 assert.equal(raw,stored,"missing original key must fail closed without changing the profile");
 console.log("PASS retired encrypted contact preference displays email; existing call/email choices, other profile details, encrypted bytes and missing-key fail-closed behavior preserved.");
}finally{if(previous===undefined)delete process.env.CRM_DATA_ENCRYPTION_KEY;else process.env.CRM_DATA_ENCRYPTION_KEY=previous;}
