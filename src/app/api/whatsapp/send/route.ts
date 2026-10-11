import { dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { publicOrigin } from "@/lib/config";
import { prisma } from "@/lib/db";
import { customerFor, relatedFor, optionalId, transactionAudit } from "@/lib/transactions";
import { isWithdrawnBooking, netOfRefundTotal } from "@/lib/receivables";
import { DEFAULT_COPY } from "@/lib/whatsapp";
export async function POST(req: Request) {
  try {
    const user = await requireSession("whatsapp:send"); const b = await req.json();
    const customerId = optionalId(b.customerId); if (!customerId) throw new ApiError(400, "Select a customer.");
    const result = await prisma.$transaction(async tx => {
      const customer = await customerFor(tx, user, customerId);
      const { booking, visaCase } = await relatedFor(tx, user, customerId, optionalId(b.bookingId), optionalId(b.visaCaseId));
      const invoiceId = optionalId(b.invoiceId);
      const invoice = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : null;
      if (invoiceId && (!invoice || invoice.customerId !== customerId)) throw new ApiError(400, "Invoice must belong to this customer.");
      const agency = await tx.settings.findUnique({ where: { key: "agency.name" } });
      const vars: Record<string, string> = { customer: customer.name, agency: agency?.value ?? "Your agency", outstanding: "the confirmed balance (ask your agency)", ref: "your travel services", pnr: booking?.pnr ?? booking?.bookingNo ?? "your booking (confirm the reference)", deadline: (booking?.ticketingDeadline ? dateTimeLabel(booking.ticketingDeadline) : undefined) ?? "to be confirmed by your agency", case: visaCase?.caseNo ?? "your visa application", docs: "the documents listed by your agency", stage: "awaiting an agency status confirmation", uploadLink: "Contact your agency for a private upload link.", date: (visaCase?.appointmentDate ? dateTimeLabel(visaCase.appointmentDate) : undefined) ?? "Appointment date and time must be confirmed with your agency." };
      if (booking) {
        // What we ask a customer to pay must already account for money we have returned.
        const paid = await tx.payment.aggregate({ where: { bookingId: booking.id }, _sum: { amount: true } });
        const back = await tx.refund.aggregate({ where: { bookingId: booking.id, status: "PAID" }, _sum: { amount: true } });
        const net = netOfRefundTotal(paid._sum.amount ?? 0, back._sum.amount ?? 0);
        vars.outstanding = `${inrAmount((isWithdrawnBooking(booking.status) ? 0 : Math.max(0, booking.sellingPrice - net)))}`;
        vars.ref = booking.bookingNo;
      }
      if (visaCase) { vars.outstanding = `${inrAmount(Math.max(0, visaCase.sellingPrice - visaCase.amountReceived))}`; vars.ref = visaCase.caseNo; const stage = await tx.visaStage.findUnique({ where: { id: visaCase.stageId } }); vars.stage = stage?.name ?? ""; const docs = await tx.document.findMany({ where: { visaCaseId: visaCase.id, status: { in: ["REQUIRED", "REQUESTED", "REJECTED", "REUPLOAD_REQUESTED"] } } }); vars.docs = Array.from(new Set(docs.map(d => d.docType))).join(", "); }
      if (invoice) { vars.outstanding = `${inrAmount((invoice.amount - invoice.amountPaid))}`; vars.ref = invoice.invoiceNo; }
      if (b.uploadLinkId) {
        const link = await tx.uploadLink.findUnique({ where: { id: String(b.uploadLinkId) } });
        if (!link || link.customerId !== customerId || link.revoked || link.expiresAt < new Date()) throw new ApiError(400, "Upload link is not valid for this customer.");
        // Built from APP_ORIGIN, never the request host: behind a proxy the request host is the
        // internal one, and a customer sent there can never open the link they were given.
        const origin = publicOrigin(req.url);
        if (!origin) throw new ApiError(500, "The workspace address is not configured, so an upload link cannot be built. Ask an administrator to set APP_ORIGIN.");
        vars.uploadLink = `${origin}/upload/${link.token}`;
      }
      const template = optionalId(b.template); let text = optionalId(b.text);
      if (!text && template) { const copy = await tx.quickReply.findUnique({ where: { key: template } }); const source = copy?.body ?? DEFAULT_COPY[template]; if (!source) throw new ApiError(400, "This template is not configured. Write a message instead."); text = source.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? ""); }
      if (text && /\{\w+\}/.test(text)) throw new ApiError(400, "Complete all template placeholders before logging your message.");
      if (b.preview === true) return { body: text ?? "", status: "DRAFT", whatsappUrl: null };
      if (!text || text.length > 4000) throw new ApiError(400, "Write a message of 1–4000 characters.");
      let thread = await tx.whatsAppThread.findFirst({ where: { customerId } });
      if (!thread) thread = await tx.whatsAppThread.create({ data: { customerId, phone: customer.phone } });
      const message = await tx.whatsAppMessage.create({ data: { threadId: thread.id, direction: "OUT", body: text, template, staffId: user.id, status: "LOGGED" } });
      await tx.whatsAppThread.update({ where: { id: thread.id }, data: { lastMsgAt: new Date() } });
      await tx.activity.create({ data: { customerId, actorId: user.id, type: "WHATSAPP", summary: `Message logged for manual sending: ${text.slice(0, 90)}`, link: `/whatsapp?thread=${thread.id}` } });
      await transactionAudit(tx, user, "LOG", "WhatsAppMessage", message.id, "Manual handoff; delivery not verified");
      const digits = customer.phone.replace(/\D/g, "");
      return { messageId: message.id, threadId: thread.id, body: text, status: "LOGGED", whatsappUrl: digits.length >= 10 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) { return jsonError(e); }
}
