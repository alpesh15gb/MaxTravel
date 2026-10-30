/** Synthetic, disposable SQLite + server-rendered UI fixtures. No application DB or browser. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { customerSalesHistory, CUSTOMER_ENQUIRY_LIMIT } from "../src/lib/customer-sales-history";
import { CustomerSalesHistory } from "../src/components/CustomerSalesHistory";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(),"tests/.runtime"),{recursive:true});
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/customer-sales-history-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir,"fixture.db"),"");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url } } });
const user = { id: "staff-a", role: "OWNER", accessMode: "ASSIGNED", branchId: "branch-a", permissions: ["customer:view"] } as SessionUser;
const now = Date.parse("2026-10-24T12:00:00Z");
const render = (history: Awaited<ReturnType<typeof customerSalesHistory>>) => renderToStaticMarkup(createElement(CustomerSalesHistory, { history }));
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  for (const x of ["a", "b"]) {
    await db.branch.create({ data: { id: `branch-${x}`, code: x, name: x, city: "Synthetic" } });
    await db.user.create({ data: { id: `staff-${x}`, employeeCode: x, name: x, email: `${x}@example.test`, phone: "", passwordHash: "not-a-login", roleId: "role", branchId: `branch-${x}` } });
  }
  for (const id of ["one", "same-name", "other-owner", "other-branch", "merged", "empty"]) await db.customer.create({ data: { id, code: id, name: "Same name customer", phone: "", city: "Synthetic", branchId: id === "other-branch" ? "branch-b" : "branch-a", assignedToId: id === "other-owner" ? "staff-b" : "staff-a", mergedIntoId: id === "merged" ? "one" : null } });
  for (const customerId of ["one", "same-name", "other-owner", "other-branch", "merged"]) await db.salesLead.create({ data: { id: `lead-${customerId}`, customerId, title: `Enquiry ${customerId}`, source: "Fixture", ownerId: "staff-a", branchId: "branch-a" } });
  await db.salesLead.createMany({ data: [
    { id: "other-owner-lead", customerId: "one", title: "Forbidden owner", source: "Fixture", ownerId: "staff-b", branchId: "branch-a" },
    { id: "other-branch-lead", customerId: "one", title: "Forbidden branch", source: "Fixture", ownerId: "staff-b", branchId: "branch-b" },
  ] });
  const past = new Date(now - 1000);
  for (const [version, state, bookingId] of [[1, "SUPERSEDED", null], [2, "ACCEPTED", "booking-fixture"], [3, "ACCEPTED", null], [4, "PUBLISHED", null]] as const) await db.salesQuote.create({ data: { id: `quote-${version}`, leadId: "lead-one", version, state, bookingId, expiresAt: past, acceptedAt: state === "ACCEPTED" ? past : null, items: "SECRET ITEMS", terms: "SECRET TERMS", totalMinor: 12345, costMinor: 9876, shareHash: `SECRET HASH ${version}`, createdBy: "staff-a" } });
  const history = await customerSalesHistory(db, "one", user, now);
  assert.equal(history.accessible, true); assert.equal(history.total, 1);
  assert.equal(history.enquiries[0].id, "lead-one"); assert.equal(history.enquiries[0].quoteCount, 4);
  assert.deepEqual(history.enquiries[0].quotes.map(q => q.state), ["EXPIRED", "ACCEPTED", "CONVERTED"]);
  assert.equal(history.enquiries[0].href, "/sales?lead=lead-one");
  assert.doesNotMatch(JSON.stringify(history), /SECRET|costMinor|totalMinor|shareHash|booking-fixture/);
  const html = render(history);
  for (const text of ["Showing 1 of 1", "Latest 3 of 4", "Expired", "Accepted", "Converted", "No CRM booking created", "not supplier confirmation", 'href="/sales?lead=lead-one"', 'href="/sales"']) assert(html.includes(text), text);
  assert.doesNotMatch(html, /same-name|Forbidden|SECRET/);
  const empty = await customerSalesHistory(db, "empty", user, now);
  assert.equal(empty.accessible, true); assert.match(render(empty), /No enquiries visible/);
  for (const id of ["other-owner", "merged", "missing"]) { const denied = await customerSalesHistory(db, id, user, now); assert.equal(denied.accessible, false); assert.equal(denied.total, 0); assert.match(render(denied), /not available with your current access/); assert(!render(denied).includes('href="/sales"')); }
  assert.equal((await customerSalesHistory(db, "one", { ...user, permissions: [] }, now)).accessible, false);
  const branchUser = { ...user, accessMode: "BRANCH" } as SessionUser;
  assert.equal((await customerSalesHistory(db, "one", branchUser, now)).total, 2);
  assert.equal((await customerSalesHistory(db, "other-branch", branchUser, now)).accessible, false);
  assert.equal((await customerSalesHistory(db, "one", { ...branchUser, branchId: null }, now)).accessible, false);
  await db.salesLead.createMany({ data: ["WON", "LOST"].map(stage => ({ id: `closed-${stage}`, customerId: "one", title: `Closed ${stage}`, source: "Fixture", ownerId: "staff-a", branchId: "branch-a", stage })) });
  assert.deepEqual((await customerSalesHistory(db, "one", user, now)).enquiries.filter(l => l.id.startsWith("closed-")).map(l => l.stage).sort(), ["LOST", "WON"]);
  // Customer-only reassignment cannot expose leads until the existing handover moves ownership too.
  await db.customer.update({ where: { id: "one" }, data: { assignedToId: "staff-b" } });
  assert.equal((await customerSalesHistory(db, "one", user, now)).accessible, false);
  const receiver = { ...user, id: "staff-b" };
  assert(!(await customerSalesHistory(db, "one", receiver, now)).enquiries.some(l => l.id === "lead-one"));
  await db.salesLead.updateMany({ where: { customerId: "one", ownerId: "staff-a", stage: { notIn: ["WON", "LOST"] } }, data: { ownerId: "staff-b" } });
  assert((await customerSalesHistory(db, "one", receiver, now)).enquiries.some(l => l.id === "lead-one"));
  assert(!(await customerSalesHistory(db, "one", receiver, now)).enquiries.some(l => l.id.startsWith("closed-")), "Existing handover does not transfer closed enquiries; do not bypass lead scope to reveal them");
  assert.equal((await customerSalesHistory(db, "same-name", user, now)).enquiries[0].id, "lead-same-name");
  await db.salesLead.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ id: `bounded-${i}`, customerId: "same-name", title: "Bounded enquiry", source: "Fixture", ownerId: "staff-a", branchId: "branch-a" })) });
  const bounded = await customerSalesHistory(db, "same-name", user, now);
  assert.equal(bounded.total, 26); assert.equal(bounded.enquiries.length, CUSTOMER_ENQUIRY_LIMIT);
  assert.match(render(bounded), /Showing 20 of 26/);
  console.log("PASS customer sales history: isolated DB dual scope, same-name identity, denied/empty/merged states, handover, bounded counts, latest accepted/expired/converted quotes, safe projection and rendered UI exact links.");
} finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
