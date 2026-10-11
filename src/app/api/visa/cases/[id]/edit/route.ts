import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { inrAmount } from "@/lib/money";
import { money, date as parseDate } from "@/lib/transactions";

/** Edit core visa case fields (dates, fees, supplier, notes, category). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("visa:edit");
    const { id } = await ctx.params;
    const vc = await prisma.visaCase.findUnique({ where: { id } });
    if (!vc) throw new ApiError(404, "Case not found");
    if (!canTouchRecord(user, { branchId: vc.branchId, ownerId: vc.ownerId })) {
      throw new ApiError(403, "This case is outside your access scope");
    }

    const b = await req.json();
    // Fee figures are financial position: visible only with payment:view, so they cannot be
    // changed without it either. Operational fields (dates, supplier, notes) stay on visa:edit.
    if ((b.visaFee !== undefined || b.serviceFee !== undefined || b.sellingPrice !== undefined) && !user.permissions.includes("payment:view")) throw new ApiError(403, "Changing case fees requires finance visibility.");
    // A price below the money already collected would leave the case showing a balance the
    // receivables figure clamps away, so the customer would appear fully paid while holding our
    // money. The shortfall belongs in a refund, not in a re-quote.
    if (b.sellingPrice !== undefined) {
      const next = money(b.sellingPrice, "Selling price");
      if (next < vc.amountReceived) throw new ApiError(400, `Selling price cannot be below the ${inrAmount(vc.amountReceived)} already received from this case. Record a refund for the difference, or correct the receipts instead.`);
    }
    const dateField = (v: unknown, label: string) => (v ? parseDate(v, label) : null);
    if (b.supplierId && !(await prisma.supplier.findUnique({ where: { id: String(b.supplierId) } }))) throw new ApiError(400, "Supplier not found.");
    const updated = await prisma.visaCase.update({
      where: { id },
      data: {
        visaCategory: b.visaCategory !== undefined ? b.visaCategory || null : undefined,
        travelDate: b.travelDate !== undefined ? dateField(b.travelDate, "Travel date") : undefined,
        intendedStay: b.intendedStay !== undefined ? b.intendedStay || null : undefined,
        submissionDate: b.submissionDate !== undefined ? dateField(b.submissionDate, "Submission date") : undefined,
        appointmentDate: b.appointmentDate !== undefined ? dateField(b.appointmentDate, "Appointment date") : undefined,
        biometricsDate: b.biometricsDate !== undefined ? dateField(b.biometricsDate, "Biometrics date") : undefined,
        expectedDecisionDate: b.expectedDecisionDate !== undefined ? dateField(b.expectedDecisionDate, "Expected decision date") : undefined,
        decisionDate: b.decisionDate !== undefined ? dateField(b.decisionDate, "Decision date") : undefined,
        visaValidityUntil: b.visaValidityUntil !== undefined ? dateField(b.visaValidityUntil, "Visa validity") : undefined,
        visaFee: b.visaFee !== undefined ? money(b.visaFee, "Visa fee") : undefined,
        serviceFee: b.serviceFee !== undefined ? money(b.serviceFee, "Service fee") : undefined,
        sellingPrice: b.sellingPrice !== undefined ? money(b.sellingPrice, "Selling price") : undefined,
        supplierId: b.supplierId !== undefined ? b.supplierId || null : undefined,
        internalNotes: b.internalNotes !== undefined ? b.internalNotes || null : undefined,
      },
    });
    await audit(user, "EDIT", "VisaCase", id);
    return Response.json({ ok: true, case: { id: updated.id } });
  } catch (e) {
    return jsonError(e);
  }
}
