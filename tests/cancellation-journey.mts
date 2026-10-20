import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

if (process.env.DATABASE_URL !== "file:./cancellation-verification.db") throw Error("Use only isolated cancellation-verification.db.");
const origin = "http://127.0.0.1:3231", suffix = randomUUID(), password = randomBytes(30).toString("hex");
const role = await prisma.role.upsert({ where: { key: "OWNER" }, create: { key: "OWNER", name: "Fixture owner", desc: "Isolated ticketing verification" }, update: {} });
const branch = await prisma.branch.create({ data: { code: suffix, name: "Synthetic ticketing branch", city: "Test" } });
const user = await prisma.user.create({ data: { employeeCode: suffix, email: `${suffix}@example.test`, name: "Synthetic operator", phone: "", passwordHash: await bcrypt.hash(password, 12), roleId: role.id, branchId: branch.id } });
const customer = await prisma.customer.create({ data: { code: suffix, name: "Synthetic ticket customer", phone: "", city: "Test", branchId: branch.id, assignedToId: user.id, travellers: { create: [{ fullName: "Same Name" }, { fullName: "Same Name" }] } }, include: { travellers: true } });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3231", "-H", "127.0.0.1"], { env: { ...process.env, APP_ORIGIN: origin, JWT_SECRET: randomBytes(48).toString("hex"), WA_PROVIDER: "manual" }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "";
server.stdout.on("data", v => logs += v); server.stderr.on("data", v => logs += v);
async function post(path: string, body: unknown, expected = 200) {
  const r = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
  const data = await r.json(); assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  if (path === "/api/auth/login") cookie = r.headers.get("set-cookie")!.split(";")[0];
  return data;
}
try {
  let ready = false;
  for (let n = 0; n < 80; n++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 500)); }
  assert(ready, logs);
  await post("/api/auth/login", { email: user.email, password });
  async function fixture(paid:number) {
    const result=await post("/api/bookings",{customerId:customer.id,travellerIds:customer.travellers.map(t=>t.id),fare:1000,pnr:"CANCEL",sector:"DEL-BOM"});
    if(paid)await post("/api/payments",{customerId:customer.id,bookingId:result.bookingId,amount:paid,mode:"CASH"});
    return result.bookingId as string;
  }
  async function complete(id:string) {for(const status of ["SUPPLIER_PENDING","SUPPLIER_RECEIVED","APPROVED","PROCESSED","PAID"])await post("/api/refunds/update",{refundId:id,status});}
  for(const [paid,supplier,fee,refund,owed] of [[1000,0,0,1000,0],[1000,200,100,700,0],[1000,900,100,0,0],[0,200,100,0,300],[100,200,100,0,200]]) {
    const bookingId=await fixture(paid);
    const payload={bookingId,status:"CANCELLED",cancellationSupplierCharge:supplier,cancellationAgencyFee:fee,cancellationReason:"Explicit synthetic supplier terms",refundAmount:refund};
    await post("/api/bookings/status",{bookingId,status:"CANCELLED",refundAmount:refund},400);
    await post("/api/bookings/status",{...payload,refundAmount:refund+1},400);
    await post("/api/bookings/status",payload);
    await post("/api/bookings/status",payload);
    const rs=await prisma.refund.findMany({where:{bookingId}});
    assert.equal(rs.length,refund?1:0,"Retry must not duplicate refunds");
    assert.equal(await prisma.auditLog.count({where:{entity:"Booking",entityId:bookingId,action:"STATUS"}}),1);
    if(refund){await complete(rs[0].id);await post("/api/refunds/update",{refundId:rs[0].id,status:"PAID"});}
    const booking=await prisma.booking.findUniqueOrThrow({where:{id:bookingId}});
    assert.equal(booking.status,"CANCELLED");assert.equal(booking.cancellationSupplierCharge,supplier);assert.equal(booking.cancellationAgencyFee,fee);
    await post("/api/refunds",{customerId:customer.id,bookingId,amount:1,reason:"Over refund"},400);
    const ids=[bookingId,...(await prisma.payment.findMany({where:{bookingId},select:{id:true}})).map(p=>p.id),...rs.map(r=>r.id)];
    const entries=await prisma.financialEntry.findMany({where:{sourceId:{in:ids}}});
    assert.equal(entries.reduce((sum,e)=>sum+Number(e.amountMinor),0),owed*100,"Journal charge − receipts + paid refund reconciles");
    if(owed){await post("/api/payments",{customerId:customer.id,bookingId,amount:owed,mode:"CASH"});await post("/api/payments",{customerId:customer.id,bookingId,amount:1,mode:"CASH"},400);}
  }
  const active=await fixture(100);
  const cash=await post("/api/refunds",{customerId:customer.id,bookingId:active,amount:100,reason:"Deposit cash returned, sale remains"});
  await complete(cash.refund.id);
  assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:active}})).status,"PNR_CREATED","Full deposit refund does not cancel demand");
  const rejected=await fixture(1000);
  const cancel={bookingId:rejected,status:"CANCELLED",cancellationSupplierCharge:200,cancellationAgencyFee:100,cancellationReason:"Synthetic terms",refundAmount:700};
  await post("/api/bookings/status",cancel);
  const r=await prisma.refund.findFirstOrThrow({where:{bookingId:rejected}});
  await post("/api/refunds/update",{refundId:r.id,status:"REJECTED",rejectionReason:"Synthetic replacement request"});
  const again=await post("/api/refunds",{customerId:customer.id,bookingId:rejected,amount:700,reason:"Replacement approved terms"});
  await complete(again.refund.id);
  assert.equal(await prisma.refund.count({where:{bookingId:rejected,status:"PAID"}}),1);
  const reserved=await fixture(1000);
  await post("/api/refunds",{customerId:customer.id,bookingId:reserved,amount:900,reason:"Existing promise"});
  await post("/api/bookings/status",{...cancel,bookingId:reserved,refundAmount:0},409);
  assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:reserved}})).status,"PNR_CREATED");
  const roleManager=await prisma.role.upsert({where:{key:"BRANCH_MANAGER"},create:{key:"BRANCH_MANAGER",name:"Synthetic manager",desc:"Scope test"},update:{}});
  const manager=await prisma.user.create({data:{employeeCode:`M-${suffix}`,email:`manager-${suffix}@example.test`,name:"Synthetic manager",phone:"",passwordHash:await bcrypt.hash(password,12),roleId:roleManager.id,branchId:branch.id}});
  const foreignBranch=await prisma.branch.create({data:{code:`F-${suffix}`,name:"Foreign scope",city:"Test"}});
  const foreign=await prisma.booking.create({data:{bookingNo:`FOREIGN-${suffix}`,customerId:customer.id,ownerId:user.id,branchId:foreignBranch.id,sellingPrice:1000}});
  await post("/api/auth/login",{email:manager.email,password});
  await post("/api/bookings/status",{...cancel,bookingId:foreign.id,refundAmount:0},403);
  assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:foreign.id}})).status,"ENQUIRY");
  console.log("Cancellation API journey passed: explicit terms, full/partial/zero, unpaid/deposit collection, retry, rejected reservation, pending conflict, active cash refund and journal reconciliation.");
} finally {server.kill("SIGTERM");await prisma.$disconnect();}
