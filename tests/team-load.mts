/** Disposable SQLite fixture for the admin Team card and the to-do transfer wording. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(), "tests/.runtime"), { recursive: true });
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/team-load-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir, "fixture.db"), "");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
process.env.DATABASE_URL = url;
const { prisma: db } = await import("../src/lib/db");
const { teamLoad, transferSummary } = await import("../src/lib/team-load");
const person = (id: string, accessMode: string, branchId: string, permissions: string[]) => ({ id, name: id, email: `${id}@example.test`, role: "OWNER", roleName: "x", branchId, branchName: branchId, employeeCode: id, accessMode, permissions }) as unknown as SessionUser;
const admin = ["case:assign", "task:view"];
const now = new Date("2026-11-05T06:30:00Z"); // 12:00 IST
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  for (const b of ["a", "b"]) await db.branch.create({ data: { id: `branch-${b}`, code: b, name: b, city: "Synthetic" } });
  for (const [id, b] of [["asha", "a"], ["bala", "b"], ["gone", "a"]] as const) await db.user.create({ data: { id, employeeCode: id, name: id === "asha" ? "Asha" : id === "bala" ? "Bala" : "Gone", email: `${id}@example.test`, phone: "", passwordHash: "x", roleId: "role", branchId: `branch-${b}`, active: id !== "gone" } });
  const task = (id: string, ownerId: string, branchId: string, dueAt: Date | null, status = "OPEN", unassigned = false) => db.task.create({ data: { id, title: id, ownerId, branchId, dueAt, status, unassigned } });
  await task("a-overdue", "asha", "branch-a", new Date("2026-11-04T10:00:00Z"));
  await task("a-today", "asha", "branch-a", new Date("2026-11-05T15:00:00Z")); // 20:30 IST today
  await task("a-later", "asha", "branch-a", new Date("2026-11-09T10:00:00Z"));
  await task("a-done", "asha", "branch-a", new Date("2026-11-01T10:00:00Z"), "DONE");
  await task("a-pool", "asha", "branch-a", null, "OPEN", true);
  await task("b-overdue", "bala", "branch-b", new Date("2026-11-03T10:00:00Z"));

  const all = await teamLoad(person("boss", "ALL", "branch-a", admin), now);
  assert.deepEqual(all.map(r => [r.name, r.open, r.overdue, r.dueToday]), [["Asha", 3, 1, 1], ["Bala", 1, 1, 0]]);
  const branch = await teamLoad(person("mgr", "BRANCH", "branch-a", admin), now);
  assert.deepEqual(branch.map(r => r.userId), ["asha"]);
  assert.deepEqual(await teamLoad(person("staff", "ASSIGNED", "branch-a", admin), now), []);
  assert.deepEqual(await teamLoad(person("boss2", "ALL", "branch-a", ["task:view"]), now), []);

  assert.equal(transferSummary("Owner", "Staff", "Customer prefers Hindi"), "Transferred from Owner to Staff: Customer prefers Hindi");
  assert.equal(transferSummary("Owner", null, "Back to the pool"), "Transferred from Owner to unassigned: Back to the pool");
  assert.equal(transferSummary("Owner", "Owner", "Due date moved"), "Due date moved");
  console.log("Team load and transfer wording passed.");
} finally {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
