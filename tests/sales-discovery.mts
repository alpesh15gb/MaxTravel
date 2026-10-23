/** Self-contained temporary SQLite fixtures. Never reads or writes configured application DB. */
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SALES_PAGE_SIZE, salesFilters, salesLeadPage, salesCustomerPage, salesCustomerScope, salesCustomerCursor } from "../src/lib/sales-discovery";
import type { SessionUser } from "../src/lib/session";
const dir = await mkdtemp(join(tmpdir(), "sales-discovery-fixture-")), url = `file:${join(dir, "fixture.db")}`;
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url } } });
const user = { id: "staff-a", role: "OWNER", accessMode: "BRANCH", branchId: "branch-a" } as SessionUser;
const assigned = { ...user, accessMode: "ASSIGNED" } as SessionUser;
const parse = (params: Record<string, string> = {}, customers = false) => salesFilters(new URLSearchParams(params), customers);
try {
  await db.role.create({ data: { id: "fixture-role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  for (const letter of ["a", "b"]) {
    await db.branch.create({ data: { id: `branch-${letter}`, code: letter, name: letter, city: "Synthetic" } });
    await db.user.create({ data: { id: `staff-${letter}`, employeeCode: letter, name: letter, email: `${letter}@example.test`, phone: "", passwordHash: "not-a-login", roleId: "fixture-role", branchId: `branch-${letter}` } });
  }
  await db.customer.createMany({ data: Array.from({ length: 615 }, (_, index) => ({ id: `customer-${String(index).padStart(3, "0")}`, code: `SYNTH-${String(index).padStart(3, "0")}`, name: index === 614 ? "ZZZ oldest eligible customer" : index < 2 ? "AAA duplicate customer" : `AAA customer ${String(index).padStart(3, "0")}`, phone: "", city: "Synthetic", branchId: "branch-a", assignedToId: "staff-a" })) });
  await db.customer.createMany({ data: [
    { id: "foreign-customer", code: "SYNTH-FOREIGN", name: "AAA foreign customer", phone: "", city: "Synthetic", branchId: "branch-b", assignedToId: "staff-b" },
    { id: "other-assigned-customer", code: "SYNTH-OTHER", name: "AAA other assigned", phone: "", city: "Synthetic", branchId: "branch-a", assignedToId: "staff-b" },
    { id: "merged-customer", code: "SYNTH-MERGED", name: "AAA merged", phone: "", city: "Synthetic", branchId: "branch-a", assignedToId: "staff-a", mergedIntoId: "customer-614" },
  ] });
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  await db.salesLead.createMany({ data: Array.from({ length: 265 }, (_, index) => ({ id: `lead-${String(index).padStart(3, "0")}`, customerId: "customer-614", branchId: "branch-a", ownerId: "staff-a", title: index === 0 ? "Oldest eligible 100%_request" : `Synthetic enquiry ${index}`, source: "Fixture", destination: index % 2 ? "Kerala" : "Delhi", stage: index % 2 ? "QUOTED" : "NEW", createdAt })) });
  await db.salesLead.createMany({ data: [
    { id: "foreign-lead", customerId: "foreign-customer", branchId: "branch-b", ownerId: "staff-b", title: "Foreign only", source: "Fixture", createdAt },
    { id: "foreign-customer-lead", customerId: "foreign-customer", branchId: "branch-a", ownerId: "staff-a", title: "Foreign customer only", source: "Fixture", createdAt },
    { id: "foreign-owner-lead", customerId: "customer-614", branchId: "branch-a", ownerId: "staff-b", title: "Foreign owner only", source: "Fixture", createdAt },
    { id: "other-assigned-lead", customerId: "other-assigned-customer", branchId: "branch-a", ownerId: "staff-a", title: "Other assigned only", source: "Fixture", createdAt },
  ] });
  // If scope/merged filtering happens after LIMIT, these newer ineligible records hide eligible work.
  await db.salesLead.createMany({ data: Array.from({ length: 75 }, (_, i) => ({ id: `merged-lead-${i}`, customerId: "merged-customer", branchId: "branch-a", ownerId: "staff-a", title: "Merged ineligible", source: "Fixture", createdAt: new Date("2026-08-01T00:00:00.000Z") })) });
  const first = await salesLeadPage(db, assigned, parse());
  assert.equal(first.leads.length, SALES_PAGE_SIZE); assert(first.nextCursor);
  let next: string | null = null; const ids: string[] = [];
  do { const page = await salesLeadPage(db, assigned, parse(next ? { cursor: next } : {})); assert(page.leads.length <= 50); ids.push(...page.leads.map(row => row.id)); next = page.nextCursor; } while (next);
  assert.equal(ids.length, 265); assert.equal(new Set(ids).size, 265); assert.equal(ids.at(-1), "lead-000");
  await db.salesLead.update({ where: { id: "lead-000" }, data: { title: "Oldest eligible 100%_request revised" } });
  assert.deepEqual((await salesLeadPage(db, assigned, parse())).leads.map(row => row.id), first.leads.map(row => row.id), "Edits do not reorder creation-keyset pages");
  assert.deepEqual((await salesLeadPage(db, assigned, parse({ q: "Oldest eligible 100%_request" }))).leads.map(row => row.id), ["lead-000"]);
  assert.equal((await salesLeadPage(db, assigned, parse({ q: "SYNTH-614", stage: "QUOTED" }))).leads.length, 50);
  assert((await salesLeadPage(db, assigned, parse({ q: "Kerala", stage: "QUOTED" }))).leads.every(row => row.stage === "QUOTED" && row.destination === "Kerala"));
  for (const q of ["Foreign", "Other assigned", "Merged", "SYNTH-FOREIGN", "SYNTH-OTHER"]) assert.equal((await salesLeadPage(db, assigned, parse({ q }))).leads.length, 0, `Search cannot widen assigned scope: ${q}`);
  assert.equal((await salesLeadPage(db, user, parse({ q: "Foreign owner" }))).leads.length, 1);
  assert.equal((await salesLeadPage(db, user, parse({ q: "Foreign customer" }))).leads.length, 0, "Both branch scopes must hold");
  assert.equal((await salesLeadPage(db, { ...user, branchId: null }, parse())).leads.length, 0);
  assert.equal((await salesLeadPage(db, assigned, parse(), "foreign-lead")).leads.length, 0);
  assert.equal((await salesLeadPage(db, assigned, parse(), "lead-000")).leads[0]?.id, "lead-000");
  const foreignCursor = Buffer.from(JSON.stringify({ id: "foreign-lead", createdAt: createdAt.toISOString() })).toString("base64url");
  assert((await salesLeadPage(db, assigned, parse({ cursor: foreignCursor }))).leads.every(row => row.ownerId === assigned.id && row.customerId === "customer-614"));
  assert.equal((await salesLeadPage(db, assigned, parse({ q: "' OR 1=1 --" }))).leads.length, 0, "Bound search values cannot execute SQL");
  const endCursor = Buffer.from(JSON.stringify({ id: "lead-000", createdAt: createdAt.toISOString() })).toString("base64url");
  const emptyEnd = await salesLeadPage(db, assigned, parse({ cursor: endCursor })); assert.equal(emptyEnd.leads.length, 0); assert.equal(emptyEnd.nextCursor, null);
  next = null; const customerIds: string[] = [];
  do { const page = await salesCustomerPage(db, assigned, parse(next ? { cursor: next } : {}, true)); assert(page.customers.length <= 50); customerIds.push(...page.customers.map(row => row.id)); next = page.nextCursor; } while (next);
  assert.equal(customerIds.length, 615); assert.equal(new Set(customerIds).size, 615); assert.equal(customerIds.at(-1), "customer-614");
  const customerEnd = await salesCustomerPage(db, assigned, parse({ cursor: salesCustomerCursor({ id: "customer-614", name: "ZZZ oldest eligible customer" }) }, true)); assert.equal(customerEnd.customers.length, 0); assert.equal(customerEnd.nextCursor, null);
  assert.deepEqual((await salesCustomerPage(db, assigned, parse({ q: "SYNTH-614" }, true))).customers.map(row => row.id), ["customer-614"]);
  assert.equal((await salesCustomerPage(db, assigned, parse({ q: "FOREIGN" }, true))).customers.length, 0);
  assert.equal(await db.customer.count({ where: { AND: [salesCustomerScope(assigned), { id: "foreign-customer" }] } }), 0);
  await assert.rejects(salesCustomerPage(db, assigned, parse({ cursor: salesCustomerCursor({ id: "foreign-customer", name: "AAA foreign customer" }) }, true)));
  await assert.rejects(salesCustomerPage(db, assigned, parse({ q: "SYNTH-614", cursor: salesCustomerCursor({ id: "customer-001", name: "AAA duplicate customer" }) }, true)));
  const beforeRename = await salesCustomerPage(db, assigned, parse({}, true));
  const anchorCustomer = beforeRename.customers.at(-1)!;
  await db.customer.update({ where: { id: anchorCustomer.id }, data: { name: "ZZZZ renamed cursor anchor" } });
  await assert.rejects(salesCustomerPage(db, assigned, parse({ cursor: beforeRename.nextCursor! }, true)), /customer list changed/, "A renamed anchor must not silently skip remaining customers");
  for (const bad of [{ q: "x".repeat(101) }, { q: "\u0000" }, { stage: "WON' OR 1=1" }, { cursor: "%" }, { cursor: "x".repeat(513) }, { cursor: Buffer.from(JSON.stringify({ id: "lead-001", createdAt: "2026-02-31T00:00:00.000Z" })).toString("base64url") }]) assert.throws(() => parse(bad));
  assert.throws(() => salesFilters(new URLSearchParams("q=a&q=b")));
  console.log("PASS sales discovery: 265 eligible enquiries and 615 customers fully reachable in bounded pages; oldest exact search; tie-safe cursors; merged/foreign customer/branch/assigned isolation; malformed filters fail closed.");
} finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
