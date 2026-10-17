import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { savePdf, readPdf, boundedPdf, pdfFilename, PDF_LIMIT } from "../src/lib/whatsapp-pdf";
import { approvedTemplate, freezeTemplate } from "../src/lib/meta-cloud";
import { processWhatsAppQueue } from "../src/lib/whatsapp-queue";
import { customerFor } from "../src/lib/transactions";
import type { SessionUser } from "../src/lib/session";
if (!process.env.DATABASE_URL?.includes("integration-test.db")) throw Error("Use isolated integration-test.db only.");
const previous = { ...process.env }, originalFetch = globalThis.fetch, id = randomUUID();
const root = await mkdtemp(path.join(os.tmpdir(), "maxtravel-pdf-"));
const bytes = Buffer.from("%PDF-1.7\n1 0 obj<</Type /Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
let branchId = "", customerId = "", threadId = "", attachmentId = "", uploads = 0, sends = 0, documentHeader = false, uncertain = false, withdrawDuringUpload=false;
const phone = "14155550198", phoneId = String(Date.now());
try {
 Object.assign(process.env, { UPLOAD_ROOT: root, WA_PROVIDER: "meta", WA_CLOUD_ACCESS_TOKEN: "synthetic-pdf-token", WA_CLOUD_PHONE_NUMBER_ID: phoneId, WA_CLOUD_WABA_ID: "222", WA_CLOUD_GRAPH_VERSION: "v99.0", WA_CLOUD_APP_SECRET: randomBytes(32).toString("hex"), WA_CLOUD_VERIFY_TOKEN: randomBytes(32).toString("hex"), WA_CLOUD_TEMPLATES: JSON.stringify({ PDF_RECEIPT: { name: "travel_pdf", language: "en", parameters: ["reference"] } }) });
 assert.equal(pdfFilename("../../ticket\r\n.pdf").includes("/"), false);
 await assert.rejects(boundedPdf(new Request("http://local", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: "not a PDF" })));
 await assert.rejects(boundedPdf(new Request("http://local", { method: "POST", headers: { "Content-Type": "text/plain" }, body: bytes })));
 await assert.rejects(boundedPdf(new Request("http://local", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(PDF_LIMIT+1) })));
 const stored = await savePdf(bytes); assert.deepEqual(await readPdf(stored), bytes);
 await assert.rejects(readPdf({ ...stored, sha256: "0".repeat(64) }));
 await assert.rejects(readPdf({ ...stored, storageKey: "../../secret.pdf" }));
 branchId = (await prisma.branch.create({ data: { code: `PDF-${id}`, name: "PDF test", city: "Test" } })).id;
 customerId = (await prisma.customer.create({ data: { code: `PDF-${id}`, name: "PDF Guest", phone: `+${phone}`, city: "Test", branchId, whatsappOptIn: true } })).id;
 await assert.rejects(customerFor(prisma, { id: "other-staff", accessMode: "ASSIGNED" } as SessionUser, customerId));
 threadId = (await prisma.whatsAppThread.create({ data: { customerId, phone } })).id;
 attachmentId = (await prisma.whatsAppAttachment.create({ data: { ...stored, customerId, filename: "receipt.pdf", createdBy: "test-staff" } })).id;
 globalThis.fetch = async (input, init) => {
   const url = String(input); assert.ok(url.startsWith("https://graph.facebook.com/v99.0/"));
   assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-pdf-token");
   if (url.includes("message_templates")) return Response.json({ data: [{ name: "travel_pdf", language: "en", status: "APPROVED", category: "UTILITY", components: [...(documentHeader ? [{ type: "HEADER", format: "DOCUMENT" }] : []), { type: "BODY", text: "Your receipt {{1}} is attached." }] }] });
   if (url.endsWith("/media")) { uploads++; assert.ok(init?.body instanceof FormData); const file = init.body.get("file") as File; assert.equal(file.type, "application/pdf"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes); if(withdrawDuringUpload)await prisma.customer.update({where:{id:customerId},data:{whatsappOptIn:false}});return Response.json({ id: "987654321" }); }
   if (!url.endsWith("/messages")) return Response.json({ id: phoneId });
   sends++; const payload = JSON.parse(String(init?.body)); assert.equal(payload.to, phone); assert.ok(payload.biz_opaque_callback_data);
   const document = payload.type === "template" ? payload.template.components.find((c: {type:string}) => c.type === "header").parameters[0].document : payload.document;
   assert.equal(document.id, "987654321"); assert.equal(document.filename, "receipt.pdf");
   if (uncertain) throw Error("Synthetic lost response"); return Response.json({ messages: [{ id: `wamid-pdf-${sends}` }] });
 };
 const frozen = freezeTemplate("PDF_RECEIPT", { reference: "RCP-TEST" })!;
 await assert.rejects(approvedTemplate(frozen, { id: "preview", filename: "receipt.pdf" }));
 documentHeader = true; await assert.rejects(approvedTemplate(frozen));
 assert.equal((await approvedTemplate(frozen, { id: "preview", filename: "receipt.pdf" })).body, "Your receipt RCP-TEST is attached.");
 async function queue(template: string | null) { return prisma.whatsAppMessage.create({ data: { threadId, attachmentId, direction: "OUT", body: "Travel receipt", status: "QUEUED", instance: `meta:${phoneId}`, recipient: phone, cloudTemplate: template, nextAttempt: new Date(Date.now()-1000) } }); }
 const expired = await queue(null); await processWhatsAppQueue(); assert.equal(uploads, 0); assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: expired.id } })).status, "BLOCKED");
 const template = await queue(frozen); await processWhatsAppQueue(); assert.equal(sends, 1); assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: template.id } })).status, "SENT");
 await prisma.whatsAppMessage.create({ data: { threadId, direction: "IN", at:new Date(Date.now()-1000), body: "Please send receipt", recipient: phone, providerKey: `meta:${phoneId}:inbound-pdf-${id}` } });
 const reply = await queue(null); await processWhatsAppQueue(); assert.equal(sends, 2,JSON.stringify(await prisma.whatsAppMessage.findUnique({where:{id:reply.id},select:{status:true,lastError:true,nextAttempt:true}}))); assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: reply.id } })).status, "SENT");
 uncertain = true; const unknown = await queue(frozen); await processWhatsAppQueue(); assert.equal(sends, 3); assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: unknown.id } })).status, "UNKNOWN"); await processWhatsAppQueue(); assert.equal(sends, 3);
 uncertain=false;withdrawDuringUpload=true;const withdrawnMidUpload=await queue(frozen);await processWhatsAppQueue();assert.equal(sends,3);assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({where:{id:withdrawnMidUpload.id}})).status,"FAILED");withdrawDuringUpload=false;await prisma.customer.update({where:{id:customerId},data:{whatsappOptIn:true}});
 const changed = await queue(frozen); await writeFile(path.join(root, "whatsapp-pdf", stored.storageKey), Buffer.from("%PDF-1.7\nchanged\n%%EOF\n")); await processWhatsAppQueue(); assert.equal(sends, 3); assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: changed.id } })).status, "FAILED");
 const withdrawn = await queue(frozen); await prisma.customer.update({ where: { id: customerId }, data: { whatsappOptIn: false } }); await processWhatsAppQueue(); assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: withdrawn.id } })).status, "CANCELLED");
 console.log("PASS WhatsApp PDF: bounded/private storage, integrity, customer access, document-header templates, expired-window blocking, document delivery, withdrawn consent, uncertain-send no-repeat.");
} finally {
 globalThis.fetch = originalFetch;
 if (threadId) await prisma.whatsAppMessage.deleteMany({ where: { threadId } });
 if (attachmentId) await prisma.whatsAppAttachment.delete({ where: { id: attachmentId } });
 if (threadId) await prisma.whatsAppThread.delete({ where: { id: threadId } });
 if (customerId) await prisma.customer.delete({ where: { id: customerId } });
 if (branchId) await prisma.branch.delete({ where: { id: branchId } });
 await rm(root, { recursive: true, force: true });
 for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous);
 await prisma.$disconnect();
}
