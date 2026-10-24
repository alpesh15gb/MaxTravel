import { customerSalesHistory } from "./customer-sales-history";
import { prisma } from "./db";
import type { SessionUser } from "./session";
import { maskPassportFor } from "./serialize";
import { canTouchRecord } from "./guard";
import { bookingCharge, hasCancellationAllocation, isWithdrawnBooking, balanceOf, netReceived, refundedTotal, receivablesFrom } from "./receivables";

// All dates → ISO strings; sensitive fields masked per permissions before leaving the server.

export async function loadCustomer360(customerId: string, user: SessionUser) {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      branch: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
      travellers: { orderBy: { createdAt: "asc" } },
      visaCases: {
        include: {
          stage: true,
          travellers: { include: { traveller: { select: { fullName: true } } } },
        },
        orderBy: { createdAt: "desc" },
      },
      bookings: {
        include: {
          tickets: true,
          travellers: { include: { traveller: { select: { fullName: true } } } },
          payments: { select: { amount: true } },
          refunds: { select: { amount: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      documents: { include: { traveller: { select: { fullName: true } }, verifiedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { receivedOn: "desc" }, include: { booking: { select: { bookingNo: true } }, visaCase: { select: { caseNo: true } } } },
      invoices: { orderBy: { issuedOn: "desc" } },
      refunds: { orderBy: { requestedOn: "desc" }, include: { booking: { select: { bookingNo: true } } } },
      tasks: { include: { owner: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      activities: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
      whatsappThreads: { include: { msgs: { orderBy: { at: "asc" } } } },
      uploadLinks: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!c || !canTouchRecord(user, c)) return null;
  const can = (permission: string) => user.permissions.some(p => p === permission);
  if (!can("visa:view")) c.visaCases = [];
  if (!can("ticketing:view")) c.bookings = [];
  if (!can("document:view")) c.documents = [];
  if (!can("payment:view")) c.payments = [];
  if (!can("invoice:view")) c.invoices = [];
  if (!can("refund:view")) c.refunds = [];
  if (!can("task:view")) c.tasks = [];
  if (!can("whatsapp:view")) c.whatsappThreads = [];
  if (!can("customer:edit") && !can("document:upload")) c.uploadLinks = [];
  if (user.accessMode === "ASSIGNED") {
    c.visaCases = c.visaCases.filter(v => v.ownerId === user.id);
    c.bookings = c.bookings.filter(b => b.ownerId === user.id);
    c.tasks = c.tasks.filter(t => t.ownerId === user.id || t.creatorId === user.id);
  }
  if (!can("payment:view")) {
    c.visaCases = c.visaCases.map(v => ({ ...v, visaFee: 0, serviceFee: 0, sellingPrice: 0, amountReceived: 0 }));
    c.bookings = c.bookings.map(b => ({ ...b, fare: 0, taxes: 0, markup: 0, serviceFee: 0, sellingPrice: 0, supplierCost: 0, cancellationSupplierCharge: null, cancellationAgencyFee: null, payments: [], refunds: [] }));
  }
  if (!can("sensitive:view")) c.documents = c.documents.map(d => ({ ...d, extracted: null, warnings: null }));
  // Cross-module activity can contain money or sensitive details; restrict this consolidated feed.
  if (!can("payment:view") || !can("sensitive:view")) c.activities = [];

  // Shared definition (lib/receivables): standalone invoices plus unpaid bookings and visa cases.
  const outstanding = receivablesFrom({
    invoices: c.invoices,
    bookings: c.bookings.map((b) => ({ status: b.status, sellingPrice: b.sellingPrice, cancellationSupplierCharge: b.cancellationSupplierCharge, cancellationAgencyFee: b.cancellationAgencyFee, received: b.payments.reduce((s, p) => s + p.amount, 0), refunds: b.refunds })),
    visaCases: c.visaCases.map((v) => ({ sellingPrice: v.sellingPrice, received: v.amountReceived })),
  }).total;
  const activeVisaCases = c.visaCases.filter((v) => !["CLOSED", "DELIVERED"].includes(v.stage.key)).length;
  const upcomingTrips = c.bookings.filter((b) => b.travelDate && new Date(b.travelDate).getTime() > Date.now() && !["CANCELLED", "VOID", "REFUNDED"].includes(b.status)).length;
  const pendingDocs = c.documents.filter((d) => ["REQUIRED", "REQUESTED", "RECEIVED", "UNDER_REVIEW", "REJECTED", "REUPLOAD_REQUESTED"].includes(d.status)).length;
  const openTasks = c.tasks.filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status)).length;
  const pendingRefunds = c.refunds.filter((r) => !["PAID", "REJECTED"].includes(r.status)).length;
  const lastWA = c.whatsappThreads.reduce<string | null>((latest, t) => {
    const last = t.msgs[t.msgs.length - 1];
    const at = last?.at ?? t.lastMsgAt;
    if (!latest || new Date(at) > new Date(latest)) return new Date(at).toISOString();
    return latest;
  }, null);
  const unanswered = c.whatsappThreads.some((t) => {
    const last = t.msgs[t.msgs.length - 1];
    return last && last.direction === "IN" && Date.now() - new Date(last.at).getTime() > 4 * 3600000;
  });

  return {
    salesHistory: await customerSalesHistory(prisma, customerId, user),
    customer: {
      id: c.id, code: c.code, name: c.name, type: c.type, phone: c.phone, email: c.email,
      city: c.city, address: c.address, status: c.status, companyName: c.companyName,
      branch: c.branch?.name ?? "—",
      manager: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name } : null,
      createdAt: c.createdAt.toISOString(),
    },
    summary: {
      outstanding, activeVisaCases, upcomingTrips, pendingDocs, openTasks, pendingRefunds,
      lastWhatsApp: lastWA, hasUnansweredWhatsApp: unanswered,
    },
    travellers: c.travellers.map((t) => ({
      id: t.id, fullName: t.fullName, relation: t.relation,
      dateOfBirth: t.dateOfBirth?.toISOString() ?? null,
      gender: t.gender, nationality: t.nationality,
      passportNumber: maskPassportFor(user, t.passportNumber),
      passportFull: !!t.passportNumber,
      passportIssueDate: t.passportIssueDate?.toISOString() ?? null,
      passportExpiry: t.passportExpiry?.toISOString() ?? null,
      passportPlace: t.passportPlace,
      knownTravellerNumber: t.knownTravellerNumber, frequentFlyer: t.frequentFlyer,
      primary: t.primary,
    })),
    visaCases: c.visaCases.map((v) => ({
      id: v.id, caseNo: v.caseNo, destination: v.destination, visaType: v.visaType,
      visaCategory: v.visaCategory, stage: v.stage.name, stageKey: v.stage.key,
      travelDate: v.travelDate?.toISOString() ?? null, appointmentDate: v.appointmentDate?.toISOString() ?? null,
      decisionDate: v.decisionDate?.toISOString() ?? null,
      sellingPrice: v.sellingPrice, amountReceived: v.amountReceived,
      travellers: v.travellers.map((ct) => ct.traveller.fullName).join(", "),
    })),
    bookings: c.bookings.map((b) => ({
      id: b.id, bookingNo: b.bookingNo, pnr: b.pnr, airline: b.airline, sector: b.sector,
      status: b.status, travelDate: b.travelDate?.toISOString() ?? null,
      ticketingDeadline: b.ticketingDeadline?.toISOString() ?? null,
      sellingPrice: b.sellingPrice,
      cancellationCharge: isWithdrawnBooking(b.status) && hasCancellationAllocation(b) ? bookingCharge(b) : null,
      cancellationBalance: isWithdrawnBooking(b.status) && hasCancellationAllocation(b) ? balanceOf(bookingCharge(b), netReceived(b.payments.reduce((s, p) => s + p.amount, 0), b.refunds)) : null,
      paid: b.payments.reduce((s, p) => s + p.amount, 0),
      refunded: refundedTotal(b.refunds),
      netPaid: netReceived(b.payments.reduce((s, p) => s + p.amount, 0), b.refunds),
      tickets: b.tickets.map((t) => ({ ticketNo: t.ticketNo, passenger: t.passenger, status: t.status })),
      travellers: b.travellers.map((bt) => bt.traveller.fullName).join(", "),
    })),
    documents: c.documents.map((d) => ({
      id: d.id, docNo: d.docNo, docType: d.docType, status: d.status,
      traveller: d.traveller?.fullName ?? null,
      uploadedAt: d.uploadedAt?.toISOString() ?? null, uploadSource: d.uploadSource,
      verificationStatus: d.verificationStatus, verifiedBy: d.verifiedBy?.name ?? null,
      expiryDate: d.expiryDate?.toISOString() ?? null,
      hasFile: !!d.storagePath, version: d.version,
      rejectionReason: d.rejectionReason,
      warnings: d.warnings ? JSON.parse(d.warnings) : [],
      extracted: d.extracted ? JSON.parse(d.extracted) : null,
      extractionConfirmed: !!d.extractedConfirmedAt,
    })),
    payments: c.payments.map((p) => ({
      id: p.id, receiptNo: p.receiptNo, amount: p.amount, mode: p.mode,
      receivedOn: p.receivedOn.toISOString(),
      ref: p.booking?.bookingNo ?? p.visaCase?.caseNo ?? null,
    })),
    invoices: c.invoices.map((i) => ({
      id: i.id, invoiceNo: i.invoiceNo, description: i.description, amount: i.amount,
      amountPaid: i.amountPaid, status: i.status, issuedOn: i.issuedOn.toISOString(),
      dueDate: i.dueDate?.toISOString() ?? null,
    })),
    refunds: c.refunds.map((r) => ({
      id: r.id, refundNo: r.refundNo, amount: r.amount, status: r.status, reason: r.reason,
      requestedOn: r.requestedOn.toISOString(), paidOn: r.paidOn?.toISOString() ?? null,
      booking: r.booking?.bookingNo ?? null,
    })),
    tasks: c.tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      owner: t.owner.name, dueAt: t.dueAt?.toISOString() ?? null,
    })),
    notes: c.notes.map((n) => ({
      id: n.id, body: n.body, author: n.author?.name ?? "—", pinned: n.pinned,
      createdAt: n.createdAt.toISOString(),
    })),
    activities: c.activities.map((a) => ({
      id: a.id, type: a.type, summary: a.summary, actor: a.actor?.name ?? "System",
      createdAt: a.createdAt.toISOString(), link: a.link,
    })),
    whatsapp: c.whatsappThreads.map((t) => ({
      id: t.id, phone: t.phone, unread: t.unread,
      messages: t.msgs.map((m) => ({
        id: m.id, direction: m.direction, body: m.body, at: m.at.toISOString(), status: m.status,
        template: m.template,
      })),
      lastAt: t.lastMsgAt.toISOString(),
    })),
    uploadLinks: c.uploadLinks.map((l) => ({
      id: l.id, token: l.token, note: l.note, expiresAt: l.expiresAt.toISOString(),
      usedAt: l.usedAt?.toISOString() ?? null, revoked: l.revoked,
      url: `/upload/${l.token}`,
    })),
  };
}

export type Customer360 = NonNullable<Awaited<ReturnType<typeof loadCustomer360>>>;
