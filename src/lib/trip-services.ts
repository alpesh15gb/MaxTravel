import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { ApiError } from "./guard";
import { caseFor, canEditCase } from "./service-cases";
import { isClosedCase } from "./case-constants";

export type TripServiceRequest = "VISA" | "QUOTE";

/**
 * The visa and quote forms open only for a trip that already has that service on file.
 * This adds it (once) so "Add visa" / "Add quote" on any trip opens the form instead of bouncing back.
 */
export async function addTripService(db: PrismaClient, user: SessionUser, caseId: string, want: TripServiceRequest): Promise<{ href: string }> {
  const can = (p: string) => user.permissions.includes(p as SessionUser["permissions"][number]);
  const allowed = want === "VISA" ? can("visa:create") : can("customer:edit") && can("ticketing:create");
  if (!allowed || !canEditCase(user)) throw new ApiError(403, "Your role cannot add this service.");
  return db.$transaction(async tx => {
    const trip = await caseFor(tx, user, caseId);
    if (isClosedCase(trip)) throw new ApiError(409, "Reopen the trip before adding a service.");
    const href = want === "VISA" ? `/visa/new?case=${trip.id}` : `/sales?action=new&case=${trip.id}`;
    const existing = await tx.serviceWork.findMany({ where: { caseId: trip.id }, select: { service: true } });
    const has = (s: string) => existing.some(w => w.service === s);
    if (want === "VISA" ? has("VISA") : has("FLIGHT") || has("HOTEL")) return { href };
    const service = want === "VISA" ? "VISA" : "FLIGHT";
    await tx.serviceWork.create({ data: { caseId: trip.id, service, title: trip.title } });
    await tx.serviceCaseEvent.create({ data: { caseId: trip.id, actorId: user.id, kind: "SERVICE_ADDED", summary: want === "VISA" ? "Visa added to this trip" : "Quote started on this trip" } });
    await tx.auditLog.create({ data: { userId: user.id, action: "SERVICE_ADDED", entity: "ServiceCase", entityId: trip.id, detail: service } });
    return { href };
  }, { isolationLevel: "Serializable" });
}
