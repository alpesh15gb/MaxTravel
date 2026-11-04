import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage, ApiError } from "@/lib/guard";
import { CASE_READ, caseFor, canAssignCase, roleCanOwnCase } from "@/lib/service-cases";
import { readTrip } from "@/lib/trips-read";
import { readWork } from "@/lib/work-read";
import { tripHistory } from "@/lib/trip-history";
import TripView from "./TripView";
export const dynamic = "force-dynamic";

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePage([...CASE_READ]), { id } = await params, sp = await searchParams;
  let base;
  try { base = await caseFor(prisma, user, id); } catch (e) { if (e instanceof ApiError && e.status === 404) notFound(); throw e; }
  const historyPage = Math.max(1, Math.min(10000, Math.trunc(Number(sp.history)) || 1));
  const [trip, history, owners] = await Promise.all([
    readTrip(user, base.id),
    tripHistory(user, base.id, historyPage),
    canAssignCase(user) ? prisma.user.findMany({ where: { active: true, ...(user.accessMode === "ALL" ? {} : { branchId: base.branchId }) }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" } }) : [],
  ]);
  const ownerOptions = owners.filter(o => roleCanOwnCase(o.role.key)).map(({ id, name }) => ({ id, name }));
  if (!ownerOptions.some(o => o.id === base.ownerId)) ownerOptions.push({ id: base.ownerId, name: trip.owner });
  const workQuery = new URLSearchParams({ case: base.id, view: "all" });
  for (const [k, v] of Object.entries(sp)) if (v && ["view", "q", "owner", "service", "page"].includes(k)) workQuery.set(k, v);
  const work = user.permissions.includes("task:view") ? await readWork(user, workQuery) : null;
  return <TripView
    user={user} trip={trip} work={work}
    record={{ id: base.id, version: base.updatedAt.toISOString(), status: base.status, ownerId: base.ownerId, followUp: base.nextFollowUpAt?.toISOString() ?? null }}
    imported={base.importedAt ? { at: base.importedAt.toISOString(), reference: base.legacyReference, source: base.importSource, stage: base.legacyStage } : null}
    owners={ownerOptions}
    history={{ open: Boolean(sp.history), page: historyPage, more: history.more, rows: history.rows.map(e => ({ ...e, at: e.at.toISOString() })) }}
  />;
}
