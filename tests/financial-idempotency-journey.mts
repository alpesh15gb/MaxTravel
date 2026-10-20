import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

if (process.env.DATABASE_URL !== "file:./financial-idempotency-verification.db") throw Error("Use only isolated financial-idempotency-verification.db.");
const origin = "http://127.0.0.1:3234", suffix = randomUUID(), password = randomBytes(30).toString("hex");
const role = await prisma.role.upsert({ where: { key: "OWNER" }, create: { key: "OWNER", name: "Fixture owner", desc: "Isolated ticketing verification" }, update: {} });
const branch = await prisma.branch.create({ data: { code: suffix, name: "Synthetic ticketing branch", city: "Test" } });
const user = await prisma.user.create({ data: { employeeCode: suffix, email: `${suffix}@example.test`, name: "Synthetic operator", phone: "", passwordHash: await bcrypt.hash(password, 12), roleId: role.id, branchId: branch.id } });
const customer = await prisma.customer.create({ data: { code: suffix, name: "Synthetic ticket customer", phone: "", city: "Test", branchId: branch.id, assignedToId: user.id, travellers: { create: [{ fullName: "Same Name" }, { fullName: "Same Name" }] } }, include: { travellers: true } });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3234", "-H", "127.0.0.1"], { env: { ...process.env, APP_ORIGIN: origin, JWT_SECRET: randomBytes(48).toString("hex"), WA_PROVIDER: "manual" }, stdio: ["ignore", "pipe", "pipe"] });
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
  const booking=await post("/api/bookings",{customerId:customer.id,travellerIds:customer.travellers.map(t=>t.id),fare:1000});
  const invoiceBody={customerId:customer.id,bookingId:booking.bookingId,amount:1000,description:"Private description not stored in replay record",requestKey:randomUUID()};
  const invoice=await post("/api/invoices",invoiceBody);
  assert.deepEqual(await post("/api/invoices",invoiceBody),invoice,"Full invoiced balance replay must bypass mutable aggregate ceiling");
  await post("/api/invoices",{...invoiceBody,amount:999},409);
  assert.equal(await prisma.invoice.count({where:{bookingId:booking.bookingId}}),1);
  assert.equal(await prisma.auditLog.count({where:{entity:"Invoice",entityId:invoice.invoiceId,action:"CREATE"}}),1);
  const paymentBody={customerId:customer.id,invoiceId:invoice.invoiceId,amount:1000,mode:"CASH",note:"Private receipt note not stored in replay record",requestKey:randomUUID()};
  const payment=await post("/api/payments",paymentBody);
  assert.deepEqual(await post("/api/payments",paymentBody),payment,"Fully paid invoice replay must bypass mutable balance ceiling");
  await post("/api/payments",{...paymentBody,amount:999},409);
  assert.equal(await prisma.payment.count({where:{invoiceId:invoice.invoiceId}}),1);
  assert.equal(await prisma.auditLog.count({where:{entity:"Payment",entityId:payment.payment.id,action:"RECORD"}}),1);
  assert.equal(await prisma.financialEntry.count({where:{sourceType:"Payment",sourceId:payment.payment.id}}),1);
  // Concurrent duplicate financial creates: no automatic retries. A lock conflict is safe;
  // an explicit unchanged replay after both requests finish must retrieve the committed record.
  for(const path of ["/api/invoices","/api/payments"]){
    const body={customerId:customer.id,amount:23,requestKey:randomUUID(),...(path.endsWith("payments")?{mode:"CASH"}:{})};
    const countBefore=path.endsWith("payments")?await prisma.payment.count():await prisma.invoice.count();
    const results=await Promise.all([0,1].map(async()=>{const r=await fetch(origin+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,Cookie:cookie},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}));
    assert(results.some(r=>r.status===200),JSON.stringify(results));
    assert(results.every(r=>[200,409].includes(r.status)),JSON.stringify(results));
    const success=results.find(r=>r.status===200)!.data;
    assert.deepEqual(await post(path,body),success);
    const countAfter=path.endsWith("payments")?await prisma.payment.count():await prisma.invoice.count();
    assert.equal(countAfter-countBefore,1,"Concurrent same-key creates must commit once");
  }
  const standaloneBody={customerId:customer.id,amount:41,requestKey:randomUUID()};
  const standalone=await post("/api/invoices",standaloneBody);
  assert.deepEqual(await post("/api/invoices",standaloneBody),standalone);
  const saved=await prisma.financialMutation.findMany({where:{actorId:user.id}});
  for(const entry of saved){assert.match(entry.requestHash,/^[a-f0-9]{64}$/);assert(!entry.responseJson.includes("Private"));}
  // Keys are actor-scoped, never a capability to read someone else's response.
  const secondOwner=await prisma.user.create({data:{employeeCode:`O-${suffix}`,email:`owner2-${suffix}@example.test`,name:"Second synthetic owner",phone:"",passwordHash:await bcrypt.hash(password,12),roleId:role.id,branchId:branch.id}});
  await post("/api/auth/login",{email:secondOwner.email,password});
  const independent=await post("/api/invoices",standaloneBody);
  assert.notEqual(independent.invoiceId,standalone.invoiceId,"Another authorized actor's key is a distinct request, not access to prior response");
  assert.deepEqual(await post("/api/invoices",standaloneBody),independent);
  const managerRole=await prisma.role.upsert({where:{key:"BRANCH_MANAGER"},create:{key:"BRANCH_MANAGER",name:"Synthetic manager",desc:"Scope test"},update:{}});
  const foreignBranch=await prisma.branch.create({data:{code:`F-${suffix}`,name:"Other branch",city:"Test"}});
  const manager=await prisma.user.create({data:{employeeCode:`M-${suffix}`,email:`manager-${suffix}@example.test`,name:"Synthetic manager",phone:"",passwordHash:await bcrypt.hash(password,12),roleId:managerRole.id,branchId:foreignBranch.id}});
  await post("/api/auth/login",{email:manager.email,password});
  await post("/api/invoices",standaloneBody,403);await post("/api/payments",paymentBody,403);
  // Existing actor loses customer scope: a saved request must not bypass fresh access checks.
  await prisma.user.update({where:{id:user.id},data:{roleId:managerRole.id,branchId:foreignBranch.id}});
  await post("/api/auth/login",{email:user.email,password});
  await post("/api/invoices",standaloneBody,403);await post("/api/payments",paymentBody,403);
  console.log("Financial idempotency integration passed: full-balance/standalone replay, changed payload, concurrent requests, audit/journal once, private-body exclusion and fresh actor scope checks.");
} finally {server.kill("SIGTERM");await prisma.$disconnect();}
