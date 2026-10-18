import { requireSession, jsonError, ApiError, scopeWhere } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { balanceOf } from "@/lib/receivables";
import type { Permission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { readInvoiceTaxSnapshot } from "@/lib/invoice-config";

export const dynamic = "force-dynamic";

const ENTITY_PERM: Record<string, Permission> = {
  customers: "customer:view", visa: "visa:view", ticketing: "ticketing:view",
  payments: "payment:view", invoices: "invoice:view", refunds: "refund:view",
  tasks: "task:view", documents: "document:view", audit: "audit:view",
};

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "no data\n";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const raw = v == null ? "" : String(v);
    const s = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") + "\n";
}

export async function GET(req: Request) {
  try {
    const user = await requireSession("export:data");
    const entity = new URL(req.url).searchParams.get("entity") ?? "";
    const perm = ENTITY_PERM[entity];
    if (!perm) throw new ApiError(400, "Unknown export entity");
    if (!can(user.permissions, perm)) throw new ApiError(403, `No permission for ${entity}`);

    let rows: Record<string, unknown>[] = [];
    // A CSV leaves the building in a way no screen does: it lands in a download folder, gets emailed,
    // and keeps no session attached. Figures the app only shows with payment:view must therefore be
    // dropped here too, rather than trusted to the fact that the caller already passed visa:view.
    const showMoney = can(user.permissions, "payment:view");
    if (entity === "customers") {
      const data = await prisma.customer.findMany({
        where: scopeWhere(user, null, undefined, "assignedToId"),
        include: { branch: true, assignedTo: true },
        orderBy: { code: "asc" },
      });
      rows = data.map((c) => ({
        code: c.code, name: c.name, type: c.type, phone: c.phone, email: c.email ?? "",
        city: c.city, status: c.status, branch: c.branch.name, manager: c.assignedTo?.name ?? "",
        created: c.createdAt.toISOString().slice(0, 10),
      }));
    } else if (entity === "visa") {
      const where: Record<string, unknown> = {};
      if (user.accessMode === "BRANCH") where.branchId = user.branchId;
      if (user.accessMode === "ASSIGNED") where.ownerId = user.id;
      const data = await prisma.visaCase.findMany({
        where, include: { customer: true, stage: true, owner: true },
        orderBy: { caseNo: "asc" },
      });
      rows = data.map((v) => ({
        caseNo: v.caseNo, customer: v.customer.name, destination: v.destination, visaType: v.visaType,
        stage: v.stage.name, travelDate: v.travelDate?.toISOString().slice(0, 10) ?? "",
        // balanceOf, not raw subtraction: a negative outstanding is the one number receivables.ts
        // deliberately refuses to publish, and the export must not invent a second version of it.
        ...(showMoney ? { sellingPrice: v.sellingPrice, received: v.amountReceived, outstanding: balanceOf(v.sellingPrice, v.amountReceived) } : {}),
        owner: v.owner.name, created: v.createdAt.toISOString().slice(0, 10),
      }));
    } else if (entity === "ticketing") {
      const where: Record<string, unknown> = {};
      if (user.accessMode === "BRANCH") where.branchId = user.branchId;
      if (user.accessMode === "ASSIGNED") where.ownerId = user.id;
      const data = await prisma.booking.findMany({
        where, include: { customer: true, owner: true },
        orderBy: { bookingNo: "asc" },
      });
      rows = data.map((bk) => ({
        bookingNo: bk.bookingNo, pnr: bk.pnr ?? "", customer: bk.customer.name, airline: bk.airline ?? "",
        sector: bk.sector ?? "", status: bk.status, travelDate: bk.travelDate?.toISOString().slice(0, 10) ?? "",
        ...(showMoney ? { sellingPrice: bk.sellingPrice } : {}),
        owner: bk.owner.name,
      }));
    } else if (entity === "payments") {
      const data = await prisma.payment.findMany({ where: { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } }, include: { customer: true }, orderBy: { receivedOn: "desc" }, take: 5000 });
      rows = data.map((p) => ({ receiptNo: p.receiptNo, customer: p.customer.name, amount: p.amount, mode: p.mode, receivedOn: p.receivedOn.toISOString().slice(0, 10) }));
    } else if (entity === "invoices") {
      const data = await prisma.invoice.findMany({ where: { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } }, include: { customer: true, creditNote: true }, orderBy: { invoiceNo: "asc" } });
      rows = data.map((i) => {
        const tax = readInvoiceTaxSnapshot(i.taxSnapshot);
        return { invoiceNo: i.invoiceNo, documentKind: i.documentKind, customer: i.customer.name, description: i.description ?? "", taxableSubtotal: tax ? tax.subtotalMinor / 100 : i.amount, taxAmount: tax ? tax.taxMinor / 100 : 0, taxProfile: tax?.profile.label ?? "", sellerGSTIN: tax?.issuer.gstin ?? "", buyerGSTIN: tax?.buyer.gstin ?? "", placeOfSupply: tax?.placeOfSupply ?? "", amount: i.amount, amountPaid: i.amountPaid, status: i.status, creditNoteNo: i.creditNote?.creditNoteNo ?? "", creditedAmount: i.creditNote?.amount ?? 0, creditReason: i.creditNote?.reason ?? "", dueDate: i.dueDate?.toISOString().slice(0, 10) ?? "" };
      });
    } else if (entity === "refunds") {
      const data = await prisma.refund.findMany({ where: { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } }, include: { customer: true }, orderBy: { refundNo: "asc" } });
      rows = data.map((r) => ({ refundNo: r.refundNo, customer: r.customer.name, amount: r.amount, status: r.status, requestedOn: r.requestedOn.toISOString().slice(0, 10), paidOn: r.paidOn?.toISOString().slice(0, 10) ?? "" }));
    } else if (entity === "tasks") {
      const where: Record<string, unknown> = {};
      if (user.accessMode === "BRANCH") where.branchId = user.branchId;
      if (user.accessMode === "ASSIGNED") where.ownerId = user.id;
      const data = await prisma.task.findMany({ where, include: { owner: true }, orderBy: { createdAt: "desc" } });
      rows = data.map((t) => ({ title: t.title, status: t.status, priority: t.priority, owner: t.owner.name, dueAt: t.dueAt?.toISOString().slice(0, 10) ?? "" }));
    } else if (entity === "documents") {
      const data = await prisma.document.findMany({ where: { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } }, include: { customer: true, traveller: true }, orderBy: { docNo: "asc" } });
      rows = data.map((d) => ({ docNo: d.docNo, docType: d.docType, customer: d.customer.name, traveller: d.traveller?.fullName ?? "", status: d.status, uploadedAt: d.uploadedAt?.toISOString().slice(0, 10) ?? "", verified: d.verificationStatus }));
    } else if (entity === "audit") {
      // The audit trail is the one report a manager most often needs outside the app, and exporting it
      // is the same action as the other modules': a scoped CSV plus its own EXPORT audit entry below.
      const data = await prisma.auditLog.findMany({
        orderBy: { at: "desc" }, take: 5000,
        include: { user: { select: { name: true, employeeCode: true } } },
      });
      rows = data.map((l) => ({
        at: l.at.toISOString(), user: l.user ? `${l.user.name} (${l.user.employeeCode})` : "System",
        action: l.action, entity: l.entity, entityId: l.entityId ?? "", detail: l.detail ?? "",
      }));
    }

    await audit(user, "EXPORT", entity, undefined, `${rows.length} rows`);
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="max-travel-crm-${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
