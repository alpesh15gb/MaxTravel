import { prisma } from "./db";
import type { SessionUser } from "./session";
import { istDayKey } from "./dates";
export { transferSummary } from "./work-transfer";

export type TeamLoadRow = { userId: string; name: string; open: number; overdue: number; dueToday: number };

/** Open, overdue and due-today to-dos per active staff member, for admins who assign work. */
export async function teamLoad(user: SessionUser, now = new Date()): Promise<TeamLoadRow[]> {
  if (!user.permissions.includes("case:assign") || user.accessMode === "ASSIGNED") return [];
  if (user.accessMode === "BRANCH" && !user.branchId) return [];
  const people = await prisma.user.findMany({
    where: { active: true, ...(user.accessMode === "BRANCH" ? { branchId: user.branchId! } : {}) },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  if (!people.length) return [];
  const tasks = await prisma.task.findMany({
    where: { ownerId: { in: people.map(p => p.id) }, unassigned: false, status: { in: ["OPEN", "IN_PROGRESS"] } },
    select: { ownerId: true, dueAt: true }, take: 20000,
  });
  const endOfToday = Date.parse(`${istDayKey(now)}T00:00:00+05:30`) + 86400000;
  const rows = new Map(people.map(p => [p.id, { userId: p.id, name: p.name, open: 0, overdue: 0, dueToday: 0 }]));
  for (const t of tasks) {
    const r = rows.get(t.ownerId)!;
    r.open++;
    if (t.dueAt && t.dueAt < now) r.overdue++;
    else if (t.dueAt && t.dueAt.getTime() < endOfToday) r.dueToday++;
  }
  return [...rows.values()].filter(r => r.open > 0);
}
