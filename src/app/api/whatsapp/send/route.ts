import { createHash } from "node:crypto";
import { whatsappPhone } from "@/lib/evolution";
import { dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { publicOrigin } from "@/lib/config";
import { prisma } from "@/lib/db";
import { customerFor, relatedFor, optionalId, transactionAudit } from "@/lib/transactions";
import { isWithdrawnBooking, netOfRefundTotal } from "@/lib/receivables";
import { DEFAULT_COPY } from "@/lib/whatsapp";
import { documentList } from "@/lib/whatsapp-documents";
import { messagingConfig,isCloud,cloudReplyWindow } from "@/lib/whatsapp-provider";
import { freezeTemplate,approvedTemplate } from "@/lib/meta-cloud";
export async function POST(req: Request) {
  try {
    const user = await requireSession("whatsapp:send"); const b = await req.json();
    const customerId = optionalId(b.customerId); if (!customerId) throw new ApiError(400, "Select a customer.");
    const requestId = typeof b.requestId === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(b.requestId) ? b.requestId : null;
    if (b.preview !== true && b.requestId != null && !requestId) throw new ApiError(400, "Use a valid request ID or omit it for legacy manual logging.");
    // IDs protect manual logs too. Keep old no-ID manual callers compatible; new clients always supply one.
    const requestKey = requestId ? `manual:${user.id}:${requestId}` : null;
    await customerFor(prisma, user, customerId);
    const previous = requestKey && b.preview !== true ? await prisma.whatsAppMessage.findUnique({ where: { requestKey } }) : null;
    // A configuration change must never turn a previously manual handoff into a provider send.
    // This is still validated against the fresh customer scope and exact content inside the transaction.
    const manualReplay = previous?.status === "LOGGED" && !previous.instance && !previous.cloudTemplate;
    if (manualReplay && optionalId(b.cloudTemplateKey)) throw new ApiError(409, "This request ID was already used for another message.");
    const config = manualReplay ? null : messagingConfig(), cloud = !manualReplay && isCloud();
    if (config && b.preview !== true && !requestId) throw new ApiError(400, "A request ID is required. Refresh the inbox and retry.");
    const cloudKey=cloud&&typeof b.cloudTemplateKey==="string"?b.cloudTemplateKey:null;
    const selected=cloud&&cloudKey?freezeTemplate(cloudKey,typeof b.cloudValues==="object"&&b.cloudValues!==null?b.cloudValues:{}):null;
    if(cloudKey&&!selected)throw new ApiError(400,"Choose a configured Meta utility template.");
    const attachmentId=optionalId(b.attachmentId);
    if(attachmentId&&!cloud)throw new ApiError(400,"PDF delivery requires Meta Cloud API.");
    const attachment=attachmentId?await prisma.whatsAppAttachment.findUnique({where:{id:attachmentId}}):null;
    if(attachmentId&&(!attachment||attachment.customerId!==customerId||attachment.createdBy!==user.id))throw new ApiError(403,"Upload a PDF for this customer using your own staff account.");
    if(attachment&&b.preview!==true&&b.acceptedAttachmentId!==attachment.id)throw new ApiError(400,"Review and confirm the PDF before sending.");
    const prepared=selected?await approvedTemplate(selected,attachment?{id:"preview",filename:attachment.filename}:undefined):null;
    if(prepared&&b.preview!==true&&b.acceptedCloudBody!==prepared.body)throw new ApiError(409,"Preview and accept the current approved template wording before sending.");
    const verifiedCustomer=await prisma.customer.findUnique({where:{id:customerId},select:{phone:true}});
    const inWindow=cloud&&verifiedCustomer?await cloudReplyWindow(customerId,whatsappPhone(verifiedCustomer.phone)||""):false;
    const result = await prisma.$transaction(async tx => {
      const customer = await customerFor(tx, user, customerId);
      const { booking, visaCase } = await relatedFor(tx, user, customerId, optionalId(b.bookingId), optionalId(b.visaCaseId));
      if (booking && booking.product === "HOTEL" && b.template === "PNR_EXPIRY") throw new ApiError(400, "Hotel stays do not have airline PNR expiry reminders.");
      const invoiceId = optionalId(b.invoiceId);
      const invoice = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : null;
      if (invoiceId && (!invoice || invoice.customerId !== customerId)) throw new ApiError(400, "Invoice must belong to this customer.");
      if (invoice?.status === "CREDITED") throw new ApiError(409, "This invoice has been credited in full and cannot be sent as a payment request.");
      const agency = await tx.settings.findUnique({ where: { key: "agency.name" } });
      const vars: Record<string, string> = { customer: customer.name, agency: agency?.value ?? "Your agency", outstanding: "the confirmed balance (ask your agency)", ref: "your travel services", pnr: booking?.pnr ?? booking?.bookingNo ?? "your booking (confirm the reference)", deadline: (booking?.ticketingDeadline ? dateTimeLabel(booking.ticketingDeadline) : undefined) ?? "to be confirmed by your agency", case: visaCase?.caseNo ?? "your visa application", docs: "the documents listed by your agency", stage: "awaiting an agency status confirmation", uploadLink: "Contact your agency for a private upload link.", uploadExpiry:"Contact your agency to confirm link expiry.", date: (visaCase?.appointmentDate ? dateTimeLabel(visaCase.appointmentDate) : undefined) ?? "Appointment date and time must be confirmed with your agency." };
      if (booking) {
        // What we ask a customer to pay must already account for money we have returned.
        const paid = await tx.payment.aggregate({ where: { bookingId: booking.id }, _sum: { amount: true } });
        const back = await tx.refund.aggregate({ where: { bookingId: booking.id, status: "PAID" }, _sum: { amount: true } });
        const net = netOfRefundTotal(paid._sum.amount ?? 0, back._sum.amount ?? 0);
        vars.outstanding = `${inrAmount((isWithdrawnBooking(booking.status) ? 0 : Math.max(0, booking.sellingPrice - net)))}`;
        vars.ref = booking.bookingNo;
      }
      if (visaCase) { vars.outstanding = `${inrAmount(Math.max(0, visaCase.sellingPrice - visaCase.amountReceived))}`; vars.ref = visaCase.caseNo; const stage = await tx.visaStage.findUnique({ where: { id: visaCase.stageId } }); vars.stage = stage?.name ?? ""; const docs = await tx.document.findMany({ where: { visaCaseId: visaCase.id, status: { in: ["REQUIRED", "REQUESTED", "REJECTED", "REUPLOAD_REQUESTED"] } } }); vars.docs = documentList(docs); }
      if (invoice) { vars.outstanding = `${inrAmount((invoice.amount - invoice.amountPaid))}`; vars.ref = invoice.invoiceNo; }
      if (b.uploadLinkId) {
        const link = await tx.uploadLink.findUnique({ where: { id: String(b.uploadLinkId) } });
        if (!link || link.customerId !== customerId || link.revoked || link.expiresAt < new Date()) throw new ApiError(400, "Upload link is not valid for this customer.");
        // Built from APP_ORIGIN, never the request host: behind a proxy the request host is the
        // internal one, and a customer sent there can never open the link they were given.
        const origin = publicOrigin(req.url);
        if (!origin) throw new ApiError(500, "The workspace address is not configured, so an upload link cannot be built. Ask an administrator to set APP_ORIGIN.");
        if (visaCase && link.visaCaseId && visaCase.id !== link.visaCaseId) throw new ApiError(400,"The upload link belongs to a different visa case.");
        vars.uploadLink = `${origin}/upload/${link.token}`;
        vars.uploadExpiry = `${dateTimeLabel(link.expiresAt)} IST`;
      }
      const template = cloudKey??optionalId(b.template); let text = prepared?.body??optionalId(b.text); if(attachment&&!text)text=`Document: ${attachment.filename}`;
      if (!text && template) { const copy = await tx.quickReply.findUnique({ where: { key: template } }); const source = copy?.body ?? DEFAULT_COPY[template]; if (!source) throw new ApiError(400, "This template is not configured. Write a message instead."); text = source.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? ""); }
      if (text && /\{\w+\}/.test(text)) throw new ApiError(400, "Complete all template placeholders before logging your message.");
      if (b.preview === true) return { body: text ?? "", status: "DRAFT", whatsappUrl: null };
      if(attachment&&!selected&&(text?.length??0)>1024)throw new ApiError(400,"PDF captions must be 1024 characters or fewer.");
      if (!text || text.length > 4000) throw new ApiError(400, "Write a message of 1–4000 characters.");
      const digits = whatsappPhone(customer.phone);
      if(cloud&&!customer.phone.trim().startsWith("+"))throw new ApiError(400,"Store the customer number with + and its country code, for example +919876543210.");
      if (config && !digits) throw new ApiError(400, "Use a customer phone number with its country code, such as +919876543210.");
      if(cloud&&(!customer.whatsappOptIn||Boolean(digits&&await tx.settings.findUnique({where:{key:`wa.meta.optout.${digits}`}}))||!selected&&!inWindow))throw new ApiError(400,!customer.whatsappOptIn?"Record customer WhatsApp consent before sending.":"The 24-hour reply window is closed. Select an approved Meta utility template.");
      if (config && customer.status === "INACTIVE") throw new ApiError(400, "Messaging is disabled for inactive customers.");
      if (requestKey) {
        const prior = await tx.whatsAppMessage.findUnique({ where: { requestKey }, include: { thread: true } });
        if (prior) {
          if (prior.thread.customerId !== customerId || prior.attachmentId!==attachmentId || prior.cloudTemplate!==selected || prior.template!==template || createHash("sha256").update(prior.body).digest("hex") !== createHash("sha256").update(text).digest("hex")) throw new ApiError(409,"This request ID was already used for another message.");
          return { messageId: prior.id, threadId: prior.threadId, body: prior.body, status: prior.status,
            whatsappUrl: prior.status === "LOGGED" && !prior.instance && prior.recipient
              ? `https://wa.me/${prior.recipient}?text=${encodeURIComponent(prior.body)}` : null };
        }
        if (manualReplay) throw new ApiError(409, "The earlier manual log is no longer available. Review the conversation before preparing a new message.");
      }
      let thread = await tx.whatsAppThread.findFirst({ where: { customerId } });
      if (!thread) thread = await tx.whatsAppThread.create({ data: { customerId, phone: customer.phone } });
      const message = await tx.whatsAppMessage.create({ data: { attachmentId,cloudTemplate:selected,threadId: thread.id, direction: "OUT", body: text, template, staffId: user.id, status: config ? "QUEUED" : "LOGGED", instance: config?.instance, recipient: digits, requestKey } });
      await tx.whatsAppThread.update({ where: { id: thread.id }, data: { lastMsgAt: new Date() } });
      await tx.activity.create({ data: { customerId, actorId: user.id, type: "WHATSAPP", summary: config ? "WhatsApp message queued" : `Message logged for manual sending: ${text.slice(0, 90)}`, link: `/whatsapp?thread=${thread.id}` } });
      await transactionAudit(tx, user, config ? "QUEUE" : "LOG", "WhatsAppMessage", message.id, config ? "Provider message queued; delivery pending" : "Manual handoff; delivery not verified");
      return { messageId: message.id, threadId: thread.id, body: text, status: config ? "QUEUED" : "LOGGED", whatsappUrl: !config && digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) { return jsonError(e); }
}
