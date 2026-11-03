import {createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { requireSession, jsonError, ApiError,canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { boundedJson } from "@/lib/bounded-json";
import { customerFor, date, money, optionalId, text, transactionAudit } from "@/lib/transactions";

const METHODS = ["CASH", "UPI", "NEFT", "CARD", "CHEQUE", "BANK_TRANSFER", "OTHER"] as const;
const cents = (value: number) => Math.round(value * 100);
const round = (value: number) => Math.round(value * 100) / 100;

export async function POST(req: Request) {
  try {
    const user = await requireSession("supplier:manage");
    const b = await boundedJson(req);
    const dueId = optionalId(b.dueId);

    if(b.action==="void"){
      const reason=text(b.reason,"Void reason",500);if(!dueId||!reason||reason.length<5)throw new ApiError(400,"Choose the payable and record a clear correction reason.");
      const result=await prisma.$transaction(async tx=>{const due=await tx.supplierDue.findUnique({where:{id:dueId},include:{settlements:true}});if(!due)throw new ApiError(404,"Payable not found.");await assertDueAccess(tx,user,due);if(due.amount===0&&due.paidAmount===0&&due.paid)return {ok:true,replayed:true};if(cents(due.paidAmount)!==0||due.settlements.some(p=>!p.reversedOn))throw new ApiError(409,"Reverse the recorded supplier payments before voiding this entry. No funds are transferred by either action.");const changed=await tx.supplierDue.updateMany({where:{id:dueId,amount:due.amount,paidAmount:0},data:{amount:0,paid:true,paidOn:null}});if(changed.count!==1)throw new ApiError(409,"The payable changed. Refresh and review its balance.");await transactionAudit(tx,user,"VOID_PAYABLE","SupplierDue",dueId,JSON.stringify({originalAmount:due.amount,reason}));return {ok:true,replayed:false};});return Response.json(result);
    }
    if (b.action === "reverse") {
      if (!dueId) throw new ApiError(400, "Choose the payable first.");
      const settlementId = optionalId(b.settlementId);
      const reason = text(b.reason, "Reversal reason", 300);
      if (!settlementId || !reason || reason.length < 5) throw new ApiError(400, "Choose a settlement and enter a clear reason of at least five characters.");
      const result = await prisma.$transaction(async (tx) => {
        const [due, settlement] = await Promise.all([
          tx.supplierDue.findUnique({ where: { id: dueId } }),
          tx.supplierSettlement.findUnique({ where: { id: settlementId } }),
        ]);
        if (!due || !settlement || settlement.dueId !== due.id) throw new ApiError(404, "Settlement not found.");
        await assertDueAccess(tx,user,due);
        if (settlement.reversedOn) throw new ApiError(409, "This settlement has already been reversed.");
        const nextPaid = round(due.paidAmount - settlement.amount);
        if (nextPaid < 0) throw new ApiError(409, "The payable balance no longer matches its settlement history. Contact an administrator.");
        const reversedAt = new Date();
        const changedSettlement = await tx.supplierSettlement.updateMany({ where: { id: settlement.id, reversedOn: null }, data: { reversedOn: reversedAt, reversedById: user.id, reversalReason: reason } });
        if (changedSettlement.count !== 1) throw new ApiError(409, "Another staff member changed this settlement. Refresh and review it.");
        const changedDue = await tx.supplierDue.updateMany({ where: { id: due.id, paidAmount: due.paidAmount }, data: { paidAmount: nextPaid, paid: nextPaid >= due.amount, paidOn: nextPaid >= due.amount ? due.paidOn : null } });
        if (changedDue.count !== 1) throw new ApiError(409, "The payable changed during reversal. Refresh and review it.");
        await transactionAudit(tx, user, "REVERSE_SETTLEMENT", "SupplierDue", due.id, `${settlement.id} · ${settlement.amount.toFixed(2)} · ${reason}`);
        return { ok: true, paidAmount: nextPaid };
      });
      return Response.json(result);
    }

    if (b.action === "edit") {
      if (!dueId) throw new ApiError(400, "Choose the payable first.");
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.supplierDue.findUnique({ where: { id: dueId } });
        if (!current) throw new ApiError(404, "Payable not found.");
        await assertDueAccess(tx,user,current);
        if(current.amount===0&&current.paid)throw new ApiError(409,"A voided entry is retained for audit. Create a new payable for the correct invoice.");
        for(const field of ["bookingId","visaCaseId","supplierId"] as const)if(b[field]!==undefined&&optionalId(b[field])!==current[field])throw new ApiError(409,"The supplier and linked work are fixed. Void an incorrect entry and create the correct payable.");
        if (current.paidAmount > 0) throw new ApiError(409, "A payable with recorded settlements is locked. Reverse the settlement with a reason before editing it.");
        const amount = b.amount === undefined ? current.amount : money(b.amount, "Payable amount", true);
        const bookingId = b.bookingId === undefined ? current.bookingId : optionalId(b.bookingId);
        const supplierInvoiceNo = b.supplierInvoiceNo === undefined ? current.supplierInvoiceNo : text(b.supplierInvoiceNo, "Supplier invoice number", 100);
        if (bookingId) await validateBookingLink(tx, user, bookingId, current.supplierId);
        const description = b.description === undefined ? current.description : text(b.description, "Description", 250);
        if (!description) throw new ApiError(400, "Enter a payable description.");
        const dueDate = b.dueDate === undefined ? current.dueDate : date(b.dueDate, "Due date");
        if (!dueDate) throw new ApiError(400, "Choose a due date.");
        const saved = await tx.supplierDue.update({ where: { id: current.id }, data: { amount, description, dueDate, bookingId, supplierInvoiceNo } });
        await transactionAudit(tx, user, "EDIT", "SupplierDue", saved.id, `Payable updated · ${description}`);
        return saved;
      });
      return Response.json({ ok: true, due: updated });
    }

    if (dueId) {
      const amount = money(b.amount, "Settlement amount", true);
      const method = String(b.method ?? "OTHER").toUpperCase();
      if (!METHODS.includes(method as typeof METHODS[number])) throw new ApiError(400, "Choose a valid settlement method.");
      const requestKey = optionalId(b.requestKey) ?? randomUUID();
      if (requestKey.length > 80) throw new ApiError(400, "Settlement request key is invalid.");
      const reference = text(b.reference, "Payment reference", 120);
      const note = text(b.note, "Note", 500);
      const settledOn = date(b.settledOn, "Payment date") ?? new Date();

      const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());if(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(settledOn)>today)throw new ApiError(400,"Record only supplier payments made on or before today.");
      const result = await prisma.$transaction(async (tx) => {
        const prior = await tx.supplierSettlement.findUnique({ where: { requestKey } });
        if (prior) {
          if (prior.recordedById!==user.id||prior.method!==method||prior.reference!==reference||prior.note!==note||(b.settledOn&&prior.settledOn.getTime()!==settledOn.getTime())||prior.dueId !== dueId || cents(prior.amount) !== cents(amount)) throw new ApiError(409, "This request key was already used for a different payment.");
          const due = await tx.supplierDue.findUniqueOrThrow({ where: { id: dueId } });await assertDueAccess(tx,user,due);
          return { ok: true, replayed: true, due, settlement: prior };
        }
        const due = await tx.supplierDue.findUnique({ where: { id: dueId } });
        if (!due) throw new ApiError(404, "Payable not found.");
        await assertDueAccess(tx,user,due);if(due.amount===0)throw new ApiError(409,"A voided payable cannot receive a payment.");
        const nextPaid = round(due.paidAmount + amount);
        if (cents(nextPaid) > cents(due.amount)) throw new ApiError(400, `Settlement exceeds the payable balance of ₹${(due.amount - due.paidAmount).toFixed(2)}.`);
        const settlement = await tx.supplierSettlement.create({ data: { dueId, amount, method, reference, note, settledOn, recordedById: user.id, requestKey } });
        const isPaid = cents(nextPaid) === cents(due.amount);
        const changed = await tx.supplierDue.updateMany({ where: { id: due.id, paidAmount: due.paidAmount }, data: { paidAmount: nextPaid, paid: isPaid, paidOn: isPaid ? settledOn : due.paidOn } });
        if (changed.count !== 1) throw new ApiError(409, "The payable changed while payment was recorded. Refresh and retry.");
        await transactionAudit(tx, user, "SETTLE", "SupplierDue", due.id, `${settlement.id} · ${amount.toFixed(2)} ${method}${reference ? ` · ${reference}` : ""}; recorded in CRM only; no funds transferred`);
        return { ok: true, replayed: false, due: { ...due, paidAmount: nextPaid, paid: isPaid }, settlement };
      });
      return Response.json(result);
    }

    const supplierId = optionalId(b.supplierId);
    const description = text(b.description, "Description", 250);
    const dueDate = date(b.dueDate, "Due date");
    const amount = money(b.amount, "Payable amount", true);
    const supplierInvoiceNo = text(b.supplierInvoiceNo, "Supplier invoice number", 100);
    const bookingId = optionalId(b.bookingId),visaCaseId=optionalId(b.visaCaseId);
    if(bookingId&&visaCaseId)throw new ApiError(400,"Link a booking or visa application, not both.");
    if (!supplierId || !description || !dueDate) throw new ApiError(400, "Select a supplier, description and due date.");
    const requestKey=optionalId(b.requestKey);if(!requestKey||!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(requestKey))throw new ApiError(400,"Reload the payable form before saving; a stable request reference is required.");
    const mutationId="supplier-due-create:"+requestKey,requestHash=createHash("sha256").update(JSON.stringify({supplierId,bookingId,visaCaseId,supplierInvoiceNo,description,dueDate:dueDate.toISOString(),amount})).digest("hex");
    const due = await prisma.$transaction(async (tx) => {
      const prior=await tx.financialMutation.findUnique({where:{id:mutationId}});if(prior){if(prior.actorId!==user.id||prior.requestHash!==requestHash)throw new ApiError(409,"This payable reference belongs to different changes. Review the original payable.");const saved=await tx.supplierDue.findUniqueOrThrow({where:{id:JSON.parse(prior.responseJson).dueId}});await assertDueAccess(tx,user,saved);return saved;}
      if(!bookingId&&!visaCaseId&&user.accessMode!=="ALL")throw new ApiError(403,"Link a booking or visa application in your scope before recording a payable.");
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new ApiError(404, "Supplier not found.");
      if (bookingId) await validateBookingLink(tx, user, bookingId, supplierId);
      if(visaCaseId){const visa=await tx.visaCase.findUnique({where:{id:visaCaseId}});if(!visa||!user.permissions.includes("visa:view")||!canTouchRecord(user,visa))throw new ApiError(404,"Visa work unavailable.");await customerFor(tx,user,visa.customerId);if(visa.supplierId!==supplierId)throw new ApiError(400,"Choose visa work already linked to this supplier.");}
      const created = await tx.supplierDue.create({ data: { supplierId, bookingId,visaCaseId, supplierInvoiceNo, description, dueDate, amount } });
      await transactionAudit(tx, user, "CREATE", "SupplierDue", created.id, `${description}${supplierInvoiceNo ? ` · supplier invoice ${supplierInvoiceNo}` : ""}`);
      await tx.financialMutation.create({data:{id:mutationId,actorId:user.id,operation:"SUPPLIER_DUE_CREATE",requestKey,requestHash,responseJson:JSON.stringify({dueId:created.id})}});
      return created;
    });
    return Response.json({ ok: true, due });
  } catch (e) { return jsonError(e, "supplier-payables"); }
}

async function validateBookingLink(tx: Prisma.TransactionClient, user: Awaited<ReturnType<typeof requireSession>>, bookingId: string, supplierId: string) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new ApiError(404, "Booking not found.");
  if(booking.currency!=="INR")throw new ApiError(409,"Foreign-currency supplier settlement requires review before linking an INR payable.");
  await customerFor(tx, user, booking.customerId);if(!canTouchRecord(user,booking))throw new ApiError(403,"The booking is outside your scope.");
  if (booking.gdsSource === "TRIPJACK_API") throw new ApiError(409, "Online wallet bookings are prepaid; they cannot receive another supplier payable.");
  if (booking.supplierId !== supplierId) throw new ApiError(400, "Choose a booking already linked to this supplier.");
}

async function assertDueAccess(tx:Prisma.TransactionClient,user:Awaited<ReturnType<typeof requireSession>>,due:{bookingId:string|null;visaCaseId:string|null}){if(user.accessMode==="ALL")return;const record=due.bookingId?await tx.booking.findUnique({where:{id:due.bookingId}}):due.visaCaseId?await tx.visaCase.findUnique({where:{id:due.visaCaseId}}):null;if(!record||!canTouchRecord(user,record))throw new ApiError(403,"This payable is outside your work or branch scope.");}
