/** Disposable SQLite fixture: a visa requirement can reuse the file already on the traveller's record. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(), "tests/.runtime"), { recursive: true });
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/document-reuse-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir, "fixture.db"), "");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
process.env.DATABASE_URL = url;
const { prisma: db } = await import("../src/lib/db");
const { findOnFile, reuseDocument } = await import("../src/lib/document-reuse");
const person = (id: string, permissions: string[], accessMode = "ALL") => ({ id, name: id, email: `${id}@example.test`, role: "OWNER", roleName: "x", branchId: "b", branchName: "b", employeeCode: id, accessMode, permissions }) as unknown as SessionUser;
const owner = person("owner", ["document:upload", "document:view"]);
const today = "2026-11-05";
try {
  // Pure matching: same traveller, same type (any case), has a file, not expired or rejected; verified preferred.
  const file = (o: object) => ({ id: "f", docNo: "DOC-1", docType: "Passport", travellerId: "t", verificationStatus: "PENDING", status: "RECEIVED", expiryDate: null, hasFile: true, ...o });
  const req = { id: "r", docType: "PASSPORT", travellerId: "t" };
  assert.equal(findOnFile(req, [file({})], today)?.id, "f");
  assert.equal(findOnFile(req, [file({ id: "a" }), file({ id: "b", verificationStatus: "VERIFIED" })], today)?.id, "b");
  assert.equal(findOnFile(req, [file({ travellerId: "other" })], today), null);
  assert.equal(findOnFile(req, [file({ docType: "Visa" })], today), null);
  assert.equal(findOnFile(req, [file({ hasFile: false })], today), null);
  assert.equal(findOnFile(req, [file({ expiryDate: "2026-01-01" })], today), null);
  assert.equal(findOnFile(req, [file({ status: "REJECTED" })], today), null);

  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  await db.branch.create({ data: { id: "b", code: "b", name: "b", city: "x" } });
  await db.user.create({ data: { id: "owner", employeeCode: "o", name: "Owner", email: "o@example.test", phone: "", passwordHash: "x", roleId: "role", branchId: "b" } });
  for (const c of ["c", "other"]) await db.customer.create({ data: { id: c, code: c, name: c, phone: "", city: "x", branchId: "b" } });
  await db.traveller.create({ data: { id: "t", customerId: "c", fullName: "T" } });
  const stage = await db.visaStage.create({ data: { id: "s", key: "DOCUMENTS_PENDING", name: "Docs" } });
  await db.visaCase.create({ data: { id: "v", caseNo: "VC-1", customerId: "c", ownerId: "owner", branchId: "b", stageId: stage.id, visaType: "Tourist", destination: "UAE" } });
  const doc = (id: string, data: object) => db.document.create({ data: { id, docNo: id, customerId: "c", travellerId: "t", docType: "Passport", ...data } });
  const verifiedAt = new Date("2026-11-01T00:00:00Z");
  await doc("verified", { storagePath: "/x/p.png", fileName: "p.png", mimeType: "image/png", sizeBytes: 10, status: "ACCEPTED", verificationStatus: "VERIFIED", verifiedById: "owner", verifiedAt, uploadedAt: verifiedAt, expiryDate: new Date("2031-01-01") });
  await doc("pending", { storagePath: "/x/q.png", fileName: "q.png", status: "RECEIVED", uploadedAt: verifiedAt });
  await doc("req1", { visaCaseId: "v", status: "REQUIRED" });
  await doc("req2", { visaCaseId: "v", status: "REQUIRED" });
  await db.document.create({ data: { id: "foreign", docNo: "foreign", customerId: "other", docType: "Passport", storagePath: "/x/f.png", status: "RECEIVED" } });

  await reuseDocument(db, owner, { requirementId: "req1", sourceId: "verified" });
  const r1 = await db.document.findUniqueOrThrow({ where: { id: "req1" } });
  assert.equal(r1.storagePath, "/x/p.png"); assert.equal(r1.status, "ACCEPTED"); assert.equal(r1.verificationStatus, "VERIFIED");
  assert.equal(r1.verifiedById, "owner"); assert.equal(r1.expiryDate?.toISOString(), new Date("2031-01-01").toISOString());
  assert.equal(await db.auditLog.count({ where: { action: "REUSE", entity: "Document", entityId: "req1" } }), 1);
  // Unverified file stays waiting for review.
  await reuseDocument(db, owner, { requirementId: "req2", sourceId: "pending" });
  const r2 = await db.document.findUniqueOrThrow({ where: { id: "req2" } });
  assert.equal(r2.status, "RECEIVED"); assert.equal(r2.verificationStatus, "PENDING");
  // Guards.
  await assert.rejects(reuseDocument(db, owner, { requirementId: "req1", sourceId: "verified" }), (e: { status?: number }) => e.status === 409);
  await doc("req3", { visaCaseId: "v", status: "REQUIRED" });
  await assert.rejects(reuseDocument(db, owner, { requirementId: "req3", sourceId: "foreign" }), (e: { status?: number }) => e.status === 404);
  await assert.rejects(reuseDocument(db, person("nope", ["document:view"]), { requirementId: "req3", sourceId: "verified" }), (e: { status?: number }) => e.status === 403);
  await assert.rejects(reuseDocument(db, person("away", ["document:upload"], "ASSIGNED"), { requirementId: "req3", sourceId: "verified" }), (e: { status?: number }) => e.status === 403);
  console.log("Document reuse passed.");
} finally {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
