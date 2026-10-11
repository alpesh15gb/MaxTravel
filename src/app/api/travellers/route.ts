import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { text } from "@/lib/transactions";
import { birthDate, passportExpiry, passportIssueDate, relation } from "@/lib/travellers";

/** Create a traveller under a customer. Passport fields require sensitive:view. */
export async function POST(req: Request) {
  try {
    const user = await requireSession("traveller:create");
    const b = await req.json();
    const customerId: string = b.customerId;
    const name: string | null = text(b.fullName, "Traveller name", 150);
    if (!customerId || !name) throw new ApiError(400, customerId ? "Enter the traveller's full name." : "customerId and fullName required");

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ApiError(404, "Customer not found");
    if (!canTouchRecord(user, { branchId: customer.branchId, assignedToId: customer.assignedToId })) {
      throw new ApiError(403, "This customer is outside your access scope");
    }

    const traveller = await prisma.traveller.create({
      data: {
        customerId, fullName: name, relation: relation(b.relation) ?? "SELF",
        dateOfBirth: birthDate(b.dateOfBirth),
        gender: text(b.gender, "Gender", 40),
        nationality: text(b.nationality, "Nationality", 80) ?? "India",
        passportNumber: user.permissions.includes("sensitive:view") ? text(b.passportNumber, "Passport number", 40) : null,
        passportIssueDate: passportIssueDate(b.passportIssueDate),
        passportExpiry: passportExpiry(b.passportExpiry),
        passportPlace: user.permissions.includes("sensitive:view") ? text(b.passportPlace, "Place of issue", 120) : null,
        knownTravellerNumber: text(b.knownTravellerNumber, "Known traveller number", 40),
        frequentFlyer: text(b.frequentFlyer, "Frequent flyer number", 60),
        primary: !!b.primary,
      },
    });
    await audit(user, "CREATE", "Traveller", traveller.id, `${name} for ${customer.code}`);
    return Response.json({ ok: true, travellerId: traveller.id });
  } catch (e) {
    return jsonError(e);
  }
}