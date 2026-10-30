import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage, canTouchRecord } from "@/lib/guard";
import { can } from "@/lib/rbac";
import VisaCaseView from "./VisaCaseView";

export const dynamic = "force-dynamic";

export default async function VisaCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("visa:view");
  const { id } = await params;

  const vc = await prisma.visaCase.findUnique({
    where: { id },
    include: {
      serviceCase:{select:{id:true,caseNo:true}},
      customer: true,
      stage: true,
      supplier: true,
      owner: { select: { id: true, name: true } },
      branch: { select: { name: true } },
      travellers: { include: { traveller: true } },
      documents: {
        include: { traveller: { select: { fullName: true } }, verifiedBy: { select: { name: true } } },
        orderBy: [{ travellerId: "asc" }, { createdAt: "asc" }],
      },
      history: { include: { stage: true, by: { select: { name: true } } }, orderBy: { at: "desc" } },
      tasks: { include: { owner: { select: { name: true } } } },
      checklistLinks: { include: { checklist: { include: { items: { orderBy: { sortOrder: "asc" } } } } } },
      payments: true,
    },
  });
  if (!vc || !canTouchRecord(user, vc)) notFound();
  // Fees and receipts are financial position: hidden without payment:view, like the list-page
  // balance and Customer 360. Masking happens here so the client never receives them.
  const showMoney = can(user.permissions, "payment:view");

  const stages = await prisma.visaStage.findMany({ where: { active: true }, orderBy: { seq: "asc" } });
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

  return (
    <VisaCaseView
      vc={{
        serviceCase: vc.serviceCase, id: vc.id, caseNo: vc.caseNo,
        customer: { id: vc.customer.id, name: vc.customer.name, code: vc.customer.code, phone: vc.customer.phone },
        stage: { id: vc.stage.id, key: vc.stage.key, name: vc.stage.name },
        destination: vc.destination, visaType: vc.visaType, visaCategory: vc.visaCategory,
        travelDate: vc.travelDate?.toISOString() ?? null, intendedStay: vc.intendedStay,
        applicationDate: vc.applicationDate?.toISOString() ?? null,
        submissionDate: vc.submissionDate?.toISOString() ?? null,
        appointmentDate: vc.appointmentDate?.toISOString() ?? null,
        biometricsDate: vc.biometricsDate?.toISOString() ?? null,
        expectedDecisionDate: vc.expectedDecisionDate?.toISOString() ?? null,
        decisionDate: vc.decisionDate?.toISOString() ?? null,
        visaOutcome: vc.visaOutcome, visaValidityUntil: vc.visaValidityUntil?.toISOString() ?? null,
        visaFee: showMoney ? vc.visaFee : 0, serviceFee: showMoney ? vc.serviceFee : 0,
        sellingPrice: showMoney ? vc.sellingPrice : 0, amountReceived: showMoney ? vc.amountReceived : 0,
        supplierId: vc.supplierId, supplier: vc.supplier?.name ?? null, owner: vc.owner.name, branch: vc.branch.name,
        internalNotes: vc.internalNotes,
        travellers: vc.travellers.map((ct) => ({
          id: ct.traveller.id, fullName: ct.traveller.fullName, relation: ct.traveller.relation,
          passportNumber: can(user.permissions, "sensitive:view")
            ? ct.traveller.passportNumber
            : ct.traveller.passportNumber ? "••••••" + (ct.traveller.passportNumber ?? "").slice(-4) : null,
          passportExpiry: ct.traveller.passportExpiry?.toISOString() ?? null,
          applicantType: ct.applicantType,
        })),
        documents: (can(user.permissions, "document:view") ? vc.documents : []).map((d) => ({
          id: d.id, docNo: d.docNo, docType: d.docType, status: d.status,
          traveller: d.traveller?.fullName ?? null, travellerId: d.travellerId,
          uploadedAt: d.uploadedAt?.toISOString() ?? null, uploadSource: d.uploadSource,
          verificationStatus: d.verificationStatus, verifiedBy: d.verifiedBy?.name ?? null,
          expiryDate: d.expiryDate?.toISOString() ?? null,
          rejectionReason: d.rejectionReason,
          hasFile: !!d.storagePath, version: d.version,
          warnings: can(user.permissions, "sensitive:view") && d.warnings ? JSON.parse(d.warnings) : [],
          extracted: can(user.permissions, "sensitive:view") && d.extracted ? JSON.parse(d.extracted) : null,
          extractionConfirmed: !!d.extractedConfirmedAt,
        })),
        history: vc.history.map((h) => ({
          id: h.id, stageId: h.stageId, stage: h.stage.name, note: h.note, by: h.by?.name ?? "System",
          at: h.at.toISOString(),
        })),
        tasks: vc.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, owner: t.owner.name, dueAt: t.dueAt?.toISOString() ?? null })),
        checklist: vc.checklistLinks[0] ? {
          country: vc.checklistLinks[0].checklist.country,
          visaType: vc.checklistLinks[0].checklist.visaType,
          applicantType: vc.checklistLinks[0].checklist.applicantType,
          version: vc.checklistLinks[0].checklist.version,
          items: vc.checklistLinks[0].checklist.items.map((i) => ({ name: i.name, required: i.required, instructions: i.instructions })),
        } : null,
      }}
      stages={stages.map((s) => ({ id: s.id, key: s.key, name: s.name, seq: s.seq }))}
      suppliers={suppliers}
      perms={{
        audit: can(user.permissions, "audit:view"),
        edit: can(user.permissions, "visa:edit"),
        verify: can(user.permissions, "document:verify"),
        send: can(user.permissions, "whatsapp:send"),
        record: can(user.permissions, "payment:record"),
        money: showMoney,
      }}
    />
  );
}
