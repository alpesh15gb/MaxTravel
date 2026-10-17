import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { customerFor, optionalId, transactionAudit, text } from "@/lib/transactions";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("customer:edit");
    const { id } = await ctx.params; const b = await req.json();
    await prisma.$transaction(async tx => {
      const current = await customerFor(tx, user, id);
      const name = String(b.name ?? current.name).trim(), phone = String(b.phone ?? current.phone).trim(), email = b.email === undefined ? current.email : optionalId(b.email);
      const type = String(b.type ?? current.type), status = String(b.status ?? current.status);
      if (!name || name.length > 150 || !phone || phone.length > 40 || (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) throw new ApiError(400, "Enter a name, phone and valid email.");
      if (!["INDIVIDUAL", "CORPORATE", "SUB_AGENT"].includes(type) || !["ACTIVE", "LEAD", "INACTIVE"].includes(status)) throw new ApiError(400, "Choose a valid type and status.");
      const assignedToId = b.assignedToId === undefined ? current.assignedToId : optionalId(b.assignedToId);
      if (assignedToId !== current.assignedToId) {
        if (!["OWNER", "SUPER_ADMIN", "BRANCH_MANAGER"].includes(user.role)) throw new ApiError(403, "Only agency or branch administrators may hand over customer ownership.");
        const owner = assignedToId ? await tx.user.findUnique({ where: { id: assignedToId } }) : null;
        if (!owner?.active || owner.branchId !== current.branchId) throw new ApiError(400, "Choose an active relationship manager in this customer's branch.");
        if (b.handoverWork === true) {
          await tx.salesLead.updateMany({where:{customerId:id,ownerId:current.assignedToId??user.id,stage:{notIn:["WON","LOST"]}},data:{ownerId:owner.id}});
          await tx.booking.updateMany({ where: { customerId: id, ownerId: current.assignedToId ?? user.id }, data: { ownerId: owner.id } });
          await tx.visaCase.updateMany({ where: { customerId: id, ownerId: current.assignedToId ?? user.id }, data: { ownerId: owner.id } });
          await tx.task.updateMany({ where: { customerId: id, ownerId: current.assignedToId ?? user.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { ownerId: owner.id } });
        }
      }
      // City was previously cut at 150 characters with a silent slice, so saving could store something
      // different from what was typed and the edit looked like it had worked. Refuse it instead.
      const city = b.city === undefined ? current.city : text(b.city, "City", 150) ?? "";
      await tx.customer.update({ where: { id }, data: { name, phone, email, type, status, assignedToId, city, address: b.address === undefined ? current.address : text(b.address, "Address", 1000), companyName: b.companyName === undefined ? current.companyName : text(b.companyName, "Company name", 200) } });
      await transactionAudit(tx, user, "EDIT", "Customer", id, assignedToId !== current.assignedToId ? "Profile corrected and ownership handed over" : "Profile corrected");
      await tx.activity.create({ data: { customerId: id, actorId: user.id, type: "EDIT", summary: "Customer profile updated", link: `/customers/${id}` } });
    });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
