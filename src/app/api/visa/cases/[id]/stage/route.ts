import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { transactionAudit, optionalId } from "@/lib/transactions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("visa:edit");
    const { id } = await ctx.params;
    const { stageId, note } = await req.json();
    if (!stageId) throw new ApiError(400, "Choose a workflow stage.");
    await prisma.$transaction(async tx => {
      const vc = await tx.visaCase.findUnique({ where: { id }, include: { stage: true, documents: true } });
      if (!vc) throw new ApiError(404, "Case not found.");
      if (!canTouchRecord(user, vc)) throw new ApiError(403, "Case is outside your access.");
      const target = await tx.visaStage.findUnique({ where: { id: String(stageId) } });
      if (!target?.active) throw new ApiError(400, "Choose an active stage.");
      const decision = ["APPROVED", "REJECTED"].includes(target.key);
      const ready = await tx.visaStage.findUnique({ where: { key: "READY_FOR_SUBMISSION" } });
      const reopening = Boolean(vc.visaOutcome) && ready && target.seq < ready.seq;
      // Recording a decision and taking one back are the same privilege. Guarding only the target
      // stage let anyone with visa:edit quietly reopen an APPROVED case and erase the outcome.
      if ((decision || reopening) && !user.permissions.includes("visa:approve")) throw new ApiError(403, "Visa decisions require approval permission.");
      if (ready && target.seq >= ready.seq && !["REJECTED", "CLOSED"].includes(target.key)) {
        const items = await tx.checklistItem.findMany({ where: { id: { in: vc.documents.flatMap(d => d.checklistItemId ? [d.checklistItemId] : []) } } });
        const incomplete = vc.documents.filter(d => {
          const item = items.find(i => i.id === d.checklistItemId);
          if (item && !item.required) return false;
          return !d.storagePath || !["RECEIVED", "UNDER_REVIEW", "ACCEPTED", "SUBMITTED"].includes(d.status)
            || ((item?.needsVerification ?? true) && d.verificationStatus !== "VERIFIED")
            || (item?.needsExpiry && (!d.expiryDate || d.expiryDate <= (vc.travelDate ?? new Date())));
        });
        if (incomplete.length) throw new ApiError(400, `Complete and verify required documents before submission: ${Array.from(new Set(incomplete.map(d => d.docType))).join(", ")}. Capture valid expiry dates where required.`);
      }
      await tx.visaCase.update({ where: { id }, data: {
        stageId: target.id,
        applicationDate: target.key === "SUBMITTED" && !vc.applicationDate ? new Date() : vc.applicationDate,
        submissionDate: target.key === "SUBMITTED" && !vc.submissionDate ? new Date() : vc.submissionDate,
        decisionDate: decision ? new Date() : reopening ? null : vc.decisionDate,
        visaOutcome: decision ? target.key : reopening ? null : vc.visaOutcome,
        closedAt: target.key === "CLOSED" ? new Date() : null,
      } });
      await tx.visaCaseStatus.create({ data: { caseId: id, stageId: target.id, note: optionalId(note), byId: user.id } });
      await tx.activity.create({ data: { customerId: vc.customerId, actorId: user.id, type: "STATUS", summary: `${vc.caseNo} moved to ${target.name}`, link: `/visa/${id}` } });
      await transactionAudit(tx, user, "STAGE", "VisaCase", id, reopening ? `${target.name} · ${vc.visaOutcome} decision cleared` : target.name);
    });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
