import {
  requireSession,
  jsonError,
  ApiError,
  canTouchRecord,
  scopeWhere,
} from "@/lib/guard";
import { prisma } from "@/lib/db";
import { caseFor, CASE_READ } from "@/lib/service-cases";
export async function GET(req: Request) {
  try {
    const u = await requireSession([...CASE_READ]),
      q = new URL(req.url).searchParams,
      kind = q.get("kind"),
      id = q.get("id");
    let caseId = q.get("case");
    if (id && id !== "new") {
      if (kind === "visa") {
        if (!u.permissions.includes("visa:view"))
          throw new ApiError(403, "Visa access is required.");
        const r = await prisma.visaCase.findUnique({ where: { id } });
        if (!r || !canTouchRecord(u, r))
          throw new ApiError(404, "Application not found.");
        caseId = r.serviceCaseId;
      } else if (kind === "ticketing") {
        if (!u.permissions.includes("ticketing:view"))
          throw new ApiError(403, "Booking access is required.");
        const r = await prisma.booking.findUnique({ where: { id } });
        if (!r || !canTouchRecord(u, r))
          throw new ApiError(404, "Booking not found.");
        caseId = r.serviceCaseId;
      } else throw new ApiError(400, "Choose a service record.");
    }
    if (!caseId) return Response.json({ case: null });
    const c = await caseFor(prisma, u, caseId),
      owner = await prisma.user.findUniqueOrThrow({
        where: { id: c.ownerId },
        select: { name: true },
      });
    if (q.get("mode") === "sources") {
      const service = q.get("service");
      if (
        !["VISA", "FLIGHT", "HOTEL"].includes(service ?? "") ||
        !u.permissions.includes(
          service === "VISA" ? "visa:view" : "ticketing:view",
        )
      )
        throw new ApiError(403, "Choose a permitted service.");
      const search = q.get("q")?.slice(0, 120) ?? "",
        scope = scopeWhere(u, null, "ownerId");
      const rows =
        service === "VISA"
          ? await prisma.visaCase.findMany({
              where: {
                AND: [
                  scope,
                  { serviceCaseId: c.id, caseNo: { contains: search } },
                ],
              },
              select: { id: true, caseNo: true },
              take: 100,
              orderBy: { createdAt: "desc" },
            })
          : await prisma.booking.findMany({
              where: {
                AND: [
                  scope,
                  {
                    serviceCaseId: c.id,
                    product: service!,
                    bookingNo: { contains: search },
                  },
                ],
              },
              select: { id: true, bookingNo: true },
              take: 100,
              orderBy: { createdAt: "desc" },
            });
      return Response.json(
        {
          records: rows.map((r) => ({
            id: r.id,
            label: "caseNo" in r ? r.caseNo : r.bookingNo,
          })),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(
      {
        case: { id: c.id, caseNo: c.caseNo, title: c.title, owner: owner.name },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
