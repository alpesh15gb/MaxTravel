import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { text } from "@/lib/transactions";
import { birthDate, passportExpiry, passportIssueDate, relation } from "@/lib/travellers";

/** Edit a traveller. Passport fields require sensitive:view. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("traveller:edit");
    const { id } = await ctx.params;
    const t = await prisma.traveller.findUnique({ where: { id }, include: { customer: true } });
    if (!t) throw new ApiError(404, "Traveller not found");
    if (!canTouchRecord(user, { branchId: t.customer.branchId, assignedToId: t.customer.assignedToId })) {
      throw new ApiError(403, "This customer is outside your access scope");
    }

    const b = await req.json();
    const sensitive = user.permissions.includes("sensitive:view");
    // Refusing beats dropping. Silently ignoring a passport edit returned success, so the member of
    // staff walked away believing the number had been corrected while the old one was still on file.
    if (!sensitive && (b.passportNumber !== undefined || b.passportPlace !== undefined)) {
      throw new ApiError(403, "Viewing and editing passport numbers needs the sensitive-data permission. Leave these fields out, or ask an authorised colleague to make the change.");
    }
    const name = b.fullName !== undefined ? text(b.fullName, "Traveller name", 150) : undefined;
    if (b.fullName !== undefined && !name) throw new ApiError(400, "Enter the traveller's full name (1–150 characters).");
    const updated = await prisma.traveller.update({
      where: { id },
      data: {
        fullName: name ?? undefined,
        relation: relation(b.relation) ?? undefined,
        dateOfBirth: b.dateOfBirth !== undefined ? birthDate(b.dateOfBirth) : undefined,
        gender: b.gender !== undefined ? text(b.gender, "Gender", 40) : undefined,
        nationality: b.nationality !== undefined ? (text(b.nationality, "Nationality", 80) ?? "India") : undefined,
        passportNumber: b.passportNumber !== undefined ? text(b.passportNumber, "Passport number", 40) : undefined,
        passportIssueDate: b.passportIssueDate !== undefined ? passportIssueDate(b.passportIssueDate) : undefined,
        passportExpiry: b.passportExpiry !== undefined ? passportExpiry(b.passportExpiry, t.passportExpiry) : undefined,
        passportPlace: b.passportPlace !== undefined ? text(b.passportPlace, "Place of issue", 120) : undefined,
        knownTravellerNumber: b.knownTravellerNumber !== undefined ? text(b.knownTravellerNumber, "Known traveller number", 40) : undefined,
        frequentFlyer: b.frequentFlyer !== undefined ? text(b.frequentFlyer, "Frequent flyer number", 60) : undefined,
        primary: b.primary !== undefined ? !!b.primary : undefined,
      },
    });
    await audit(user, "EDIT", "Traveller", id);
    return Response.json({ ok: true, travellerId: updated.id });
  } catch (e) {
    return jsonError(e);
  }
}