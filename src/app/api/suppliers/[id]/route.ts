import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { transactionAudit, text } from "@/lib/transactions";

const TYPES = ["AIRLINE", "HOTEL", "BOOKING_PLATFORM", "VISA_PROCESSOR", "CONSOLIDATOR", "CONSULTANT", "OTHER"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("supplier:manage");
    const { id } = await ctx.params;
    const b = await req.json();
    await prisma.$transaction(async tx => {
      const current = await tx.supplier.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, "Supplier not found.");
      const name = String(b.name ?? current.name).trim();
      if (!name || name.length > 150) throw new ApiError(400, "Enter a supplier name.");
      if (name !== current.name) {
        const duplicate = await tx.supplier.findUnique({ where: { name } });
        if (duplicate) throw new ApiError(400, "Another supplier already uses this name.");
      }
      const type = String(b.type ?? current.type);
      if (!TYPES.includes(type)) throw new ApiError(400, "Choose a valid supplier type.");
      const terms = Number(b.paymentDueDays ?? current.paymentDueDays);
      if (!Number.isInteger(terms) || terms < 0 || terms > 365) throw new ApiError(400, "Payment terms must be 0–365 whole days.");
      await tx.supplier.update({ where: { id }, data: { name, type, phone: b.phone === undefined ? current.phone : text(b.phone, "Phone", 40), city: b.city === undefined ? current.city : text(b.city, "City", 120), contact: b.contact === undefined ? current.contact : text(b.contact, "Contact", 150), paymentDueDays: terms } });
      await transactionAudit(tx, user, "EDIT", "Supplier", id, name);
    });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
