import { randomBytes } from "node:crypto";
import { publicOrigin } from "./config";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { evolutionConfig, evolutionState, evolutionSend, EvolutionError, providerKey, whatsappPhone } from "./evolution";
import { dateTimeLabel } from "./dates";
import { inrAmount } from "./money";
import { netOfRefundTotal } from "./receivables";
import { DEFAULT_PAYMENT_TEMPLATE, PAYMENT_TEMPLATE_KEY, paymentTemplateError, renderPaymentTemplate } from "./whatsapp-templates";
import { documentList, documentRequestMessage } from "./whatsapp-documents";

export const RULES = ["BOOKING_CREATED", "TICKET_CONFIRMED", "PAYMENT_RECEIVED", "STATUS_UPDATE", "DOC_REQUEST", "APPOINTMENT_REMINDER", "PNR_EXPIRY", "PAYMENT_REMINDER"] as const;
const IMMEDIATE_RULES = ["BOOKING_CREATED", "TICKET_CONFIRMED", "PAYMENT_RECEIVED", "DOC_REQUEST"];
export type AutomationRule = typeof RULES[number];
export async function automationRules(tx: Prisma.TransactionClient = prisma): Promise<AutomationRule[]> {
  const row = await tx.settings.findUnique({ where: { key: "whatsapp.automation" } });
  try { const value = JSON.parse(row?.value ?? "[]"); return Array.isArray(value) ? RULES.filter(r => value.includes(r)) : []; }
  catch { return []; }
}

export async function queueAutomation(tx: Prisma.TransactionClient, customerId: string, rule: AutomationRule, key: string, body: string) {
  const config = evolutionConfig();
  if (!config || !(await automationRules(tx)).includes(rule)) return;
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  const phone = customer && whatsappPhone(customer.phone);
  if (!customer?.whatsappOptIn || customer.status === "INACTIVE" || !phone) return;
  const requestKey = `auto:${rule}:${key}`;
  if (await tx.whatsAppMessage.findUnique({ where: { requestKey } })) return;
  let thread = await tx.whatsAppThread.findFirst({ where: { customerId } });
  if (!thread) thread = await tx.whatsAppThread.create({ data: { customerId, phone: customer.phone } });
  await tx.whatsAppMessage.create({ data: { threadId: thread.id, direction: "OUT", body: body.slice(0,4000),
    template: rule, automation: rule, instance: config.instance, recipient: phone, status: "QUEUED", requestKey } });
  await tx.whatsAppThread.update({ where: { id: thread.id }, data: { lastMsgAt: new Date() } });
}

export async function queueStageUpdate(tx: Prisma.TransactionClient, customerId: string, caseId: string, historyId: string, stage: string) {
  const vc = await tx.visaCase.findUniqueOrThrow({ where: { id: caseId }, include: { customer: true } });
  const agency = (await tx.settings.findUnique({ where: { key: "agency.name" } }))?.value ?? "Your agency";
  await queueAutomation(tx, customerId, "STATUS_UPDATE", historyId,
    `Hello ${vc.customer.name}, your visa case ${vc.caseNo} is now at ${stage}. Please contact ${agency} if you need help.`);
  if (stage.toLowerCase().includes("document")) await queueDocumentRequest(tx, caseId, historyId);

}

const PENDING_DOCUMENTS = ["REQUIRED", "REQUESTED", "REJECTED", "REUPLOAD_REQUESTED"];
const documentNames = (docs: { docType: string }[]) => Array.from(new Set(docs.map(d=>d.docType))).join(", ").slice(0,1500);

export async function queueDocumentRequest(tx: Prisma.TransactionClient, caseId: string, eventId: string) {
  const origin = publicOrigin();
  if (!evolutionConfig() || !origin || !(await automationRules(tx)).includes("DOC_REQUEST")) return;
  const vc = await tx.visaCase.findUniqueOrThrow({ where: { id: caseId }, include: { customer: true } });
  if (vc.closedAt || !vc.customer.whatsappOptIn || vc.customer.status === "INACTIVE" || !whatsappPhone(vc.customer.phone)) return;
  const docs = await tx.document.findMany({ where: { visaCaseId: caseId, status: { in: PENDING_DOCUMENTS } }, orderBy: { createdAt: "asc" } });
  if (!docs.length || await tx.whatsAppMessage.findFirst({ where: { automation: "DOC_REQUEST", requestKey: { endsWith: `:${eventId}` } } })) return;
  // A case-wide token sees this case's applicants only. Keep queued links usable for at least 48 hours.
  let link = await tx.uploadLink.findFirst({ where: { customerId: vc.customerId, visaCaseId: caseId, travellerId: null, revoked: false, expiresAt: { gt: new Date(Date.now()+48*3600000) } }, orderBy: { createdAt: "desc" } });
  if (!link) link = await tx.uploadLink.create({ data: { token: randomBytes(24).toString("base64url"), customerId: vc.customerId, visaCaseId: caseId, expiresAt: new Date(Date.now()+7*86400000), note: "Please upload the outstanding documents listed below. Your agency will review them." } });
  const agency = (await tx.settings.findUnique({ where: { key: "agency.name" } }))?.value ?? "Your agency";
  await queueAutomation(tx, vc.customerId, "DOC_REQUEST", `${link.id}:${eventId}`,
    documentRequestMessage({customer:vc.customer.name,caseNo:vc.caseNo,docs,url:`${origin}/upload/${link.token}`,expires:dateTimeLabel(link.expiresAt),agency}));
}

export async function queueBookingConfirmation(tx: Prisma.TransactionClient, bookingId: string, ticketed = false) {
  if (!evolutionConfig()) return;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true, tickets: { where: { status: "OK" } } } });
  const agency = (await tx.settings.findUnique({ where: { key: "agency.name" } }))?.value ?? "Your agency";
  const reference = `${booking.bookingNo}${booking.pnr ? ` / PNR ${booking.pnr}` : ""}`;
  const details = `${booking.sector ? ` Route: ${booking.sector}.` : ""}${booking.travelDate ? ` Travel: ${dateTimeLabel(booking.travelDate)}.` : ""}`;
  const body = ticketed
    ? `Hello ${booking.customer.name}, ticket details are confirmed for ${reference}.${details} Ticket number(s): ${booking.tickets.map(t=>t.ticketNo).join(", ")}. Please check your itinerary with ${agency}.`
    : `Hello ${booking.customer.name}, ${agency} has recorded your booking ${reference}.${details} Ticket issuance is not yet confirmed. We will update you when ticket details are recorded.`;
  await queueAutomation(tx, booking.customerId, ticketed ? "TICKET_CONFIRMED" : "BOOKING_CREATED", booking.id, body);
}

export async function queuePaymentAcknowledgement(tx: Prisma.TransactionClient, paymentId: string) {
  if (!evolutionConfig()) return;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { customer: true, booking: true, visaCase: true, invoice: true } });
  const agency = (await tx.settings.findUnique({ where: { key: "agency.name" } }))?.value ?? "Your agency";
  const reference = payment.invoice?.invoiceNo ?? payment.booking?.bookingNo ?? payment.visaCase?.caseNo ?? "your customer account";
  // Match the CRM receivable: linked work takes precedence over its invoice.
  let balance = "Not applicable (unallocated customer advance)";
  const balanceReference = payment.booking?.bookingNo ?? payment.visaCase?.caseNo ?? payment.invoice?.invoiceNo ?? "customer advance";
  if (payment.booking || payment.visaCase) {
    const where = payment.booking ? { bookingId: payment.booking.id } : { visaCaseId: payment.visaCase!.id };
    const paid = await tx.payment.aggregate({ where, _sum: { amount: true } });
    const returned = payment.booking ? await tx.refund.aggregate({ where: { bookingId: payment.booking.id, status: "PAID" }, _sum: { amount: true } }) : null;
    const total = payment.booking?.sellingPrice ?? payment.visaCase!.sellingPrice;
    balance = inrAmount(Math.max(0, Math.round((total - netOfRefundTotal(paid._sum.amount ?? 0, returned?._sum.amount ?? 0)) * 100) / 100));
  } else if (payment.invoice) {
    balance = inrAmount(Math.max(0, Math.round((payment.invoice.amount - payment.invoice.amountPaid) * 100) / 100));
  }
  const saved = (await tx.settings.findUnique({ where: { key: PAYMENT_TEMPLATE_KEY } }))?.value;
  const template = saved && !paymentTemplateError(saved) ? saved : DEFAULT_PAYMENT_TEMPLATE;
  const values = {
    customer: payment.customer.name, agency, amount: inrAmount(payment.amount), mode: payment.mode,
    reference, receipt: payment.receiptNo, date: dateTimeLabel(payment.receivedOn), balance, balanceReference,
  };
  const body = renderPaymentTemplate(template, values);
  await queueAutomation(tx, payment.customerId, "PAYMENT_RECEIVED", payment.id, body.length <= 4000 ? body : renderPaymentTemplate(DEFAULT_PAYMENT_TEMPLATE, values));
}

export async function scheduleReminders(now = new Date()) {
  if (!evolutionConfig() || !(await automationRules()).length) return;
  const tomorrow = new Date(now.getTime() + 86400000);
  const monthAgo = new Date(now.getTime() - 30*86400000);
  await prisma.$transaction(async tx => {
    const agency = (await tx.settings.findUnique({ where: { key: "agency.name" } }))?.value ?? "Your agency";
    const cases = await tx.visaCase.findMany({ where: { closedAt: null, appointmentDate: { gt: now, lte: tomorrow }, customer: { whatsappOptIn: true, status: { not: "INACTIVE" } } }, include: { customer: true }, take: 200 });
    for (const vc of cases) await queueAutomation(tx, vc.customerId, "APPOINTMENT_REMINDER", `${vc.id}:${vc.appointmentDate!.toISOString()}`,
      `Hello ${vc.customer.name}, your appointment for ${vc.caseNo} is ${dateTimeLabel(vc.appointmentDate!)}. Please confirm the location and required documents with ${agency}.`);
    const bookings = await tx.booking.findMany({ where: { status: { in: ["PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED"] }, ticketingDeadline: { gt: now, lte: tomorrow }, customer: { whatsappOptIn: true, status: { not: "INACTIVE" } } }, include: { customer: true }, take: 200 });
    for (const bk of bookings) await queueAutomation(tx, bk.customerId, "PNR_EXPIRY", `${bk.id}:${bk.ticketingDeadline!.toISOString()}`,
      `Hello ${bk.customer.name}, the ticketing deadline for ${bk.pnr ?? bk.bookingNo} is ${dateTimeLabel(bk.ticketingDeadline!)}. Please contact ${agency} to confirm ticketing.`);
    const invoices = await tx.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIAL"] }, dueDate: { gte: monthAgo, lte: now }, customer: { whatsappOptIn: true, status: { not: "INACTIVE" } } }, include: { customer: true, booking: true }, take: 200 });
    for (const inv of invoices) {
      if (inv.amount <= inv.amountPaid || (inv.booking && ["CANCELLED", "VOID", "REFUNDED"].includes(inv.booking.status))) continue;
      await queueAutomation(tx, inv.customerId, "PAYMENT_REMINDER", `${inv.id}:${inv.dueDate!.toISOString()}`,
        `Hello ${inv.customer.name}, ${inrAmount(inv.amount-inv.amountPaid)} remains due for ${inv.invoiceNo}. If you have already paid, please contact ${agency} to reconcile your receipt.`);
    }
  }, { timeout: 15000 });
}

export async function processWhatsAppQueue() {
  const config = evolutionConfig();
  if (!config) return { state: "unconfigured", processed: 0 };
  // Crash recovery: an interrupted send cannot be retried safely without a provider receipt.
  await prisma.whatsAppMessage.updateMany({ where: { status: "SENDING", claimedAt: { lt: new Date(Date.now()-120000) } }, data: { status: "UNKNOWN", lastError: "Send interrupted. Verify in WhatsApp before sending again." } });
  let state: string;
  try { state = await evolutionState(); } catch { return { state: "unreachable", processed: 0 }; }
  if (state !== "open") return { state, processed: 0 };
  // Reminders use quiet hours. Confirmations of a staff-recorded transaction send immediately.
  const indiaHour = (new Date().getUTCHours() + 5 + (new Date().getUTCMinutes() >= 30 ? 1 : 0)) % 24;
  const quiet = indiaHour < 9 || indiaHour >= 20;
  const rules = await automationRules();
  const messages = await prisma.whatsAppMessage.findMany({ where: { status: "QUEUED", instance: config.instance,
    nextAttempt: { lte: new Date() }, ...(quiet ? { OR: [{ automation: null }, { automation: { in: IMMEDIATE_RULES } }] } : {}) }, orderBy: { at: "asc" }, take: 10,
    include: { thread: { include: { customer: true } } } });
  let processed = 0;
  for (const message of messages) {
    const customer = message.thread.customer;
    const current = !message.automation || await reminderIsCurrent(message.automation, message.requestKey!, message.body);
    if (whatsappPhone(customer.phone) !== message.recipient || customer.status === "INACTIVE" ||
      !current || (message.automation && (!customer.whatsappOptIn || !rules.includes(message.automation as AutomationRule) || Date.now()-message.at.getTime()>48*3600000))) {
      await prisma.whatsAppMessage.updateMany({ where: { id: message.id, status: "QUEUED" }, data: { status: "CANCELLED", lastError: "Recipient, consent or automation settings changed, or reminder expired." } });
      continue;
    }
    // Upgrade an unsent request from the previous layout without creating or resending a message.
    let body = message.body;
    if (message.automation === "DOC_REQUEST" && body.includes(". Upload privately:")) {
      const linkId = message.requestKey?.split(":")[2];
      const link = linkId ? await prisma.uploadLink.findUnique({where:{id:linkId},include:{visaCase:true}}) : null;
      const origin = publicOrigin();
      if (link?.visaCase && origin) {
        const docs = await prisma.document.findMany({where:{visaCaseId:link.visaCaseId,status:{in:PENDING_DOCUMENTS}},orderBy:{createdAt:"asc"}});
        const agency=(await prisma.settings.findUnique({where:{key:"agency.name"}}))?.value??"Your agency";
        body=documentRequestMessage({customer:customer.name,caseNo:link.visaCase.caseNo,docs,url:`${origin}/upload/${link.token}`,expires:dateTimeLabel(link.expiresAt),agency});
      }
    }
    const claim = await prisma.whatsAppMessage.updateMany({ where: { id: message.id, status: "QUEUED" },
      data: { status: "SENDING", body, claimedAt: new Date(), attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      const id = await evolutionSend(message.recipient!, body);
      // Receipt webhooks can beat this response; do not downgrade a delivered/read message.
      const key = providerKey(id);
      const receipt = await prisma.settings.findUnique({ where: { key: `wa.receipt.${key}` } });
      await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { providerKey: key, status: receipt?.value ?? "SENT", lastError: null } });
    } catch (error) {
      const e = error instanceof EvolutionError ? error : new EvolutionError(true, false, "Send outcome unknown. Verify in WhatsApp.");
      const retry = e.retryable && !e.uncertain && message.attempts < 4;
      await prisma.whatsAppMessage.updateMany({ where: { id: message.id, status: "SENDING" }, data: {
        status: e.uncertain ? "UNKNOWN" : retry ? "QUEUED" : "FAILED", lastError: e.message,
        nextAttempt: new Date(Date.now() + Math.min(3600000, 60000 * 2**message.attempts)),
      } });
    }
    processed++;
  }
  return { state, processed };
}

async function reminderIsCurrent(rule: string, key: string, body: string) {
  const parts = key.split(":"), id = parts[2], when = parts.slice(3).join(":");
  if (rule === "BOOKING_CREATED" || rule === "TICKET_CONFIRMED") {
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking || ["CANCELLED","VOID","REFUNDED"].includes(booking.status)) return false;
    return rule === "TICKET_CONFIRMED" ? booking.status === "TICKETED" : !["TICKETED","REISSUED"].includes(booking.status);
  }
  if (rule === "PAYMENT_RECEIVED") return Boolean(await prisma.payment.findUnique({ where: { id } }));
  if (rule === "APPOINTMENT_REMINDER") {
    const vc = await prisma.visaCase.findUnique({ where: { id } });
    return Boolean(vc && !vc.closedAt && vc.appointmentDate && vc.appointmentDate.toISOString() === when && vc.appointmentDate > new Date());
  }
  if (rule === "PNR_EXPIRY") {
    const bk = await prisma.booking.findUnique({ where: { id } });
    return Boolean(bk && ["PNR_CREATED","ON_HOLD","PAYMENT_AWAITED"].includes(bk.status) && bk.ticketingDeadline && bk.ticketingDeadline.toISOString() === when && bk.ticketingDeadline > new Date());
  }
  if (rule === "PAYMENT_REMINDER") {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: { booking: true } });
    return Boolean(inv && ["UNPAID","PARTIAL"].includes(inv.status) && inv.amount > inv.amountPaid && inv.dueDate?.toISOString() === when &&
      body.includes(`${inrAmount(inv.amount-inv.amountPaid)} remains due`) && (!inv.booking || !["CANCELLED","VOID","REFUNDED"].includes(inv.booking.status)));
  }
  if (rule === "DOC_REQUEST" && when) {
    const link = await prisma.uploadLink.findUnique({ where: { id }, include: { visaCase: true } });
    if (!link || link.revoked || link.expiresAt <= new Date() || !link.visaCase || link.visaCase.closedAt || !body.includes(`/upload/${link.token}`)) return false;
    const docs = await prisma.document.findMany({ where: { visaCaseId: link.visaCaseId, status: { in: PENDING_DOCUMENTS } }, orderBy: { createdAt: "asc" } });
    // Retain valid requests queued by the previous release while validating the new layout.
    return Boolean(docs.length && (body.includes(`\n\n${documentList(docs)}\n\n*Private upload link*\n`) || body.includes(`: ${documentNames(docs)}. Upload privately:`)));
  }
  const history = await prisma.visaCaseStatus.findUnique({ where: { id }, include: { case: true } });
  if (!history || history.case.stageId !== history.stageId) return false;
  if (rule === "DOC_REQUEST") {
    const docs = await prisma.document.findMany({ where: { visaCaseId: history.caseId, status: { in: ["REQUIRED","REQUESTED","REJECTED","REUPLOAD_REQUESTED"] } } });
    const names = Array.from(new Set(docs.map(d=>d.docType))).join(", ");
    return Boolean(names && body.includes(`: ${names}. Contact`));
  }
  return true;
}
