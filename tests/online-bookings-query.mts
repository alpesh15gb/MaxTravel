/** Isolated fixture DB only. Run: node --import tsx tests/online-bookings-query.mts */
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { parseOnlineBookingFilters as parse, onlineBookingQuery as query, onlineBookingPage as page, onlineBookingsHref as href } from "../src/lib/online-bookings-query";
import { scopeWhere } from "../src/lib/guard";
import type { SessionUser } from "../src/lib/session";

const dir = await mkdtemp(join(tmpdir(), "online-bookings-fixture-"));
const url = `file:${join(dir, "fixture.db")}`;
// Schema and database both live in a new temporary directory; never use configured application DB.
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url } } });
const user = { id: "staff-a", role: "OWNER", accessMode: "BRANCH", branchId: "branch-a" } as SessionUser;
const scope = scopeWhere(user, user.branchId, "ownerId");
const parseHref = (link: string) => parse(Object.fromEntries(new URL(link, "http://fixture.test").searchParams));
async function fetchPage(filters = parse({}), access = scope) { return page(await db.booking.findMany(query(filters, access)), filters); }
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  for (const suffix of ["a", "b"]) {
    await db.branch.create({ data: { id: `branch-${suffix}`, code: suffix, name: suffix, city: "Fixture" } });
    await db.user.create({ data: { id: `staff-${suffix}`, employeeCode: suffix, name: suffix, email: `${suffix}@example.test`, phone: "", passwordHash: "not-a-real-password", roleId: "role", branchId: `branch-${suffix}` } });
    await db.customer.create({ data: { id: `customer-${suffix}`, code: suffix, name: `Shared customer ${suffix}`, phone: "", city: "Fixture", branchId: `branch-${suffix}` } });
  }
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  await db.$transaction(Array.from({ length: 135 }, (_, i) => db.booking.create({ data: {
    id: `booking-${String(i).padStart(3, "0")}`, bookingNo: `ONLINE-${String(i).padStart(3, "0")}`, gdsSource: "TRIPJACK_API", customerId: "customer-a", ownerId: "staff-a", branchId: "branch-a", createdAt,
    product: i % 2 ? "HOTEL" : "FLIGHT", status: i % 2 ? "ENQUIRY" : "TICKETED", pnr: `PNR-${i}`,
  } })));
  await db.booking.create({ data: { id: "unrelated", bookingNo: "ONLINE-OTHER", gdsSource: "TRIPJACK_API", customerId: "customer-b", ownerId: "staff-b", branchId: "branch-b", createdAt } });
  await db.booking.create({ data: { id: "other-owner-same-branch", bookingNo: "ONLINE-OTHER-OWNER", gdsSource: "TRIPJACK_API", customerId: "customer-a", ownerId: "staff-b", branchId: "branch-a", createdAt } });
  await db.booking.create({ data: { id: "offline", bookingNo: "ONLINE-OFFLINE", gdsSource: "MANUAL", customerId: "customer-a", ownerId: "staff-a", branchId: "branch-a", createdAt } });
  const first = await fetchPage();
  assert.equal(first.rows.length, 50); assert(first.hasOlder); assert(!first.hasNewer);
  let current = first, filters = parse({}); const ids: string[] = [];
  do {
    ids.push(...current.rows.map(row => row.id));
    if (!current.hasOlder) break;
    filters = parseHref(href(filters, "older", current.rows.at(-1)!));
    current = await fetchPage(filters);
  } while (true);
  assert.equal(ids.length, 136); assert.equal(new Set(ids).size, 136); assert(!ids.includes("unrelated")); assert(!ids.includes("offline"));
  const secondFilters = parseHref(href(parse({}), "older", first.rows.at(-1)!));
  const second = await fetchPage(secondFilters);
  const back = await fetchPage(parseHref(href(secondFilters, "newer", second.rows[0])));
  assert.deepEqual(back.rows.map(r => r.id), first.rows.map(r => r.id)); assert(!back.hasNewer);
  // Snapshot updates cannot reorder creation-based pagination.
  await db.booking.update({ where: { id: ids.at(-1)! }, data: { status: "REFUND_PENDING" } });
  assert.deepEqual((await fetchPage()).rows.map(r => r.id), first.rows.map(r => r.id));
  const assigned = scopeWhere({ ...user, accessMode: "ASSIGNED" }, user.branchId, "ownerId");
  const searched = await fetchPage(parse({ q: "Shared customer", product: "HOTEL", status: "ENQUIRY" }), assigned);
  assert.equal(searched.rows.length, 50); assert(searched.rows.every(r => r.ownerId === "staff-a" && r.branchId === "branch-a" && r.product === "HOTEL" && r.status === "ENQUIRY"));
  const exactOld = await fetchPage(parse({ q: "ONLINE-001" }), assigned);
  assert.deepEqual(exactOld.rows.map(r => r.id), ["booking-001"]);
  assert.equal((await fetchPage(parse({ q: "OTHER" }), assigned)).rows.length, 0, "Search OR must not override assigned scope OR");
  assert.equal((await fetchPage(parse({ q: "PNR-1" }))).rows.some(r => r.id === "booking-001"), true);
  assert.equal((await fetchPage(parse({}), scopeWhere({ ...user, branchId: null }, null, "ownerId"))).rows.length, 0);
  // Foreign or nonexistent cursor IDs are values, never fetched as unscoped records.
  const foreignCursor = parseHref(href(parse({}), "older", { id: "unrelated", createdAt }));
  assert((await fetchPage(foreignCursor)).rows.every(r => r.branchId === "branch-a"));
  for (const bad of [{ q: "x".repeat(101) }, { q: ["a", "b"] }, { product: "BOAT" }, { status: "UNKNOWN" }, { cursor: "%" }, { cursor: "a".repeat(513) }, { direction: "newer" }, { direction: "sideways", cursor: "e30" }, { cursor: Buffer.from(JSON.stringify({ id: "x", createdAt: "2026-02-31T00:00:00.000Z" })).toString("base64url") }]) {
    const parsed = parse(bad); assert(parsed.invalid, JSON.stringify(bad)); assert.equal((await fetchPage(parsed)).rows.length, 0);
  }
  const combined = parse({ q: "ONLINE", product: "HOTEL", status: "ENQUIRY" });
  const next = parseHref(href(combined, "older", searched.rows.at(-1)!));
  assert.equal(next.q, combined.q); assert.equal(next.product, combined.product); assert.equal(next.status, combined.status); assert(next.cursor);
  assert(!parseHref(href(next)).cursor, "First page / apply filters resets pagination");
  assert.equal(query(parse({}), scope).take, 51);
  if (process.argv.includes("--http-only") || process.argv.includes("--browser")) {
    const { verifyOnlineBookingsUi } = await import("./online-bookings-browser.mjs");
    await verifyOnlineBookingsUi(db, url, process.argv.includes("--browser"));
  }
  console.log("PASS online booking queue: >100 fixtures, stable bidirectional pages, branch/assigned isolation, search/filter combinations, malformed params, foreign cursor, bounded page size");
} finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
