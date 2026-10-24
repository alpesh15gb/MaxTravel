/** Disposable migrated SQLite only; no application database or provider actions. */
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { salesAttention, salesDayEnd, SALES_ATTENTION_LIMIT } from "../src/lib/sales-attention";
import { computePulse } from "../src/lib/pulse";
import type { SessionUser } from "../src/lib/session";
const dir = await mkdtemp(join(tmpdir(), "sales-attention-")), url = `file:${join(dir, "fixture.db")}`;
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url } } });
const user = { id: "staff-a", name: "Fixture", role: "OWNER", accessMode: "BRANCH", branchId: "branch-a", permissions: ["customer:view"] } as SessionUser;
const now = Date.parse("2026-10-24T12:00:00Z"), end = salesDayEnd(now);
const ids = (items: Awaited<ReturnType<typeof salesAttention>>) => items.map(item => item.id);
try {
  assert.equal(end.toISOString(), "2026-10-24T18:30:00.000Z");
  assert.equal(salesDayEnd(end.getTime()).toISOString(), "2026-10-25T18:30:00.000Z");
  assert.equal(salesDayEnd(end.getTime()-1).toISOString(), end.toISOString());
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test" } });
  for (const letter of ["a", "b"]) {
    await db.branch.create({ data: { id: `branch-${letter}`, code: letter, name: letter, city: "Synthetic" } });
    await db.user.create({ data: { id: `staff-${letter}`, employeeCode: letter, name: letter, email: `${letter}@example.test`, phone: "", passwordHash: "not-a-login", roleId: "role", branchId: `branch-${letter}` } });
    await db.customer.create({ data: { id: `customer-${letter}`, code: letter, name: `Customer ${letter}`, phone: "", city: "Synthetic", branchId: `branch-${letter}`, assignedToId: `staff-${letter}` } });
  }
  await db.customer.create({ data: { id: "merged", code: "merged", name: "Hidden merged", phone: "", city: "Synthetic", branchId: "branch-a", assignedToId: "staff-a", mergedIntoId: "customer-a" } });
  const base = { customerId: "customer-a", ownerId: "staff-a", branchId: "branch-a", source: "Fixture" };
  const lead = (id: string, extra = {}) => db.salesLead.create({ data: { ...base, id, title: id, followUpAt: new Date(now-1), ...extra } });
  for (const [id, extra] of Object.entries({ overdue: {}, today: { followUpAt: new Date(end.getTime()-1) }, exact: { followUpAt: new Date(now) }, tomorrow: { followUpAt: end }, undated: { followUpAt: null }, lost: { stage: "LOST" }, converted: { stage: "WON" }, foreign: { branchId: "branch-b" }, foreignCustomer: { customerId: "customer-b" }, otherOwner: { ownerId: "staff-b" }, merged: { customerId: "merged" }, accepted: { followUpAt: null }, both: {} })) await lead(id, extra);
  for (const id of ["accepted", "both", "lost", "converted"]) await db.salesQuote.create({ data: { id: `q-${id}`, leadId: id, version: 1, state: "ACCEPTED", items: "[]", terms: "Private", totalMinor: 987654321, costMinor: 123456789, createdBy: user.id, expiresAt: new Date(now-1000) } });
  const items = await salesAttention(db, user, now);
  assert.deepEqual(new Set(ids(items)), new Set(["sales:overdue", "sales:today", "sales:exact", "sales:otherOwner", "sales:accepted", "sales:both"]));
  assert.equal(items.find(i=>i.id==="sales:overdue")?.severity, "HIGH");
  assert.equal(items.find(i=>i.id==="sales:today")?.severity, "MEDIUM");
  assert.equal(items.find(i=>i.id==="sales:exact")?.severity, "MEDIUM");
  assert.equal(items.find(i=>i.id==="sales:accepted")?.at, undefined, "Accepted does not invent a deadline, even when quote expired after acceptance");
  assert.equal(items.filter(i=>i.id==="sales:both").length, 1, "Accepted and overdue are one actionable enquiry");
  assert.equal(items.find(i=>i.id==="sales:both")?.href, "/sales?lead=both");
  assert(!JSON.stringify(items).includes("987654321")); assert(!JSON.stringify(items).includes("Private"));
  assert.equal((await salesAttention(db, { ...user, permissions: [] }, now)).length, 0);
  assert.equal((await salesAttention(db, { ...user, branchId: null }, now)).length, 0);
  assert(!ids(await salesAttention(db, { ...user, accessMode: "ASSIGNED" }, now)).includes("sales:otherOwner"));
  await db.customer.update({where:{id:"customer-a"},data:{assignedToId:"staff-b"}});
  assert.equal((await salesAttention(db,{...user,accessMode:"ASSIGNED"},now)).length,0,"Assigned customer scope also required");
  await db.customer.update({where:{id:"customer-a"},data:{assignedToId:"staff-a"}});
  assert(ids(await salesAttention(db, { ...user, accessMode: "ALL" }, now)).includes("sales:foreign"));
  const taskCount = await db.task.count();
  await db.salesLead.update({ where: { id: "overdue" }, data: { followUpAt: end } });
  await db.salesLead.update({ where: { id: "today" }, data: { stage: "LOST" } });
  await db.salesQuote.update({ where: { id: "q-accepted" }, data: { bookingId: "synthetic-booking" } });
  await db.salesLead.update({ where: { id: "both" }, data: { stage: "WON", followUpAt: null } });
  const refreshed = ids(await salesAttention(db, user, now));
  for (const id of ["overdue", "today", "accepted", "both"]) assert(!refreshed.includes(`sales:${id}`), `Fresh read removes resolved ${id}`);
  assert.equal(await db.task.count(), taskCount, "Queue is derived; it never creates tasks");
  // Flood ineligible older records: scope must run before the cap, not after it.
  await db.salesLead.createMany({ data: Array.from({length:60},(_,i)=>({...base,id:`hidden-${i}`,title:"Never visible",customerId:"customer-b",followUpAt:new Date(0)})) });
  await db.salesLead.createMany({ data: Array.from({length:51},(_,i)=>({...base,id:`cap-${String(i).padStart(2,"0")}`,title:"Visible",followUpAt:new Date(1)})) });
  const capped = await salesAttention(db,user,now);
  assert.equal(capped.length,SALES_ATTENTION_LIMIT+1); assert.equal(capped.at(-1)?.id,"capped:sales");
  assert.equal(capped[0].id,"sales:cap-00"); assert.equal(capped[49].id,"sales:cap-49");
  assert(!JSON.stringify(capped).includes("Never visible"));
  // Exactly 50 visible records must not claim truncation.
  await db.salesLead.updateMany({where:{id:{in:["exact","otherOwner","cap-50"]}},data:{followUpAt:null}});
  const exactCap=await salesAttention(db,user,now);
  assert.equal(exactCap.length,50); assert(!ids(exactCap).includes("capped:sales"));
  const pulse = await computePulse(db,user);
  assert(pulse.items.some(i=>i.id==="sales:cap-00"),"Today includes sales work");
  assert.equal(pulse.receivables.total,0,"Sales prices are not booked receivables");
  console.log("PASS sales Today: IST boundaries, real deadlines, accepted/unconverted dedupe, role/dual scope/merged isolation before cap, fresh-read removal, no tasks or financial pollution.");
} finally { await db.$disconnect(); await rm(dir, { recursive:true, force:true }); }
