import assert from "node:assert/strict";
import { composerReady, createWhatsAppComposerMemory, WHATSAPP_DRAFT_LIMIT, WHATSAPP_DRAFT_TTL } from "../src/lib/whatsapp-composer-memory";
let now = 1000, ids = 0;
const memory = createWhatsAppComposerMemory("session-a-staff-a-scope-a", () => now);
const id = () => `synthetic-request-${++ids}`;
const sent = { url: "https://wa.me/15550000001?text=fixture", body: "Private A text", status: "LOGGED" };
let a = memory.activate("a");
const delayedA = memory.beginPreview("a", a, false)!; assert(delayedA);
assert.equal(memory.beginPreview("a", a, false), null, "Repeated preview is synchronously locked");
let b = memory.activate("b"); memory.edit("b", { draft: "Private B draft" }, b);
assert.equal(memory.finishPreview(delayedA, "Hello Customer A"), false);
assert.equal(memory.get("b").draft, "Private B draft"); assert.equal(memory.get("a").draft, "");
a = memory.activate("a"); assert.equal(memory.finishPreview(delayedA, "Hello Customer A"), false, "A → B → A is a new generation");
const quick = memory.beginPreview("a", a, false)!; memory.edit("a", { draft: "New typed A draft" }, a);
assert.equal(memory.finishPreview(quick, "Old quick reply"), false, "Late quick reply cannot overwrite manual edits");
const sendA = memory.beginSend("a", a, [], id)!; assert(sendA);
assert.equal(memory.beginSend("a", a, [], id), null, "Repeated send is locked before React renders");
assert.equal(memory.beginConsent("a", a), null); assert.equal(memory.discard("a"), false);
assert.equal(sendA.fields.draft, "New typed A draft");
memory.edit("a", { draft: "Newer A draft after submit" }, a);
b = memory.activate("b");
assert(memory.finishSend(sendA, "acknowledged", sent));
assert.equal(memory.get("b").draft, "Private B draft"); assert.equal(memory.get("b").handoff, null);
assert.equal(memory.get("a").draft, "Newer A draft after submit"); assert(memory.get("a").handoff?.newerDraftKept);
assert.equal(memory.finishSend(sendA, "acknowledged", sent), false, "An old completion cannot settle twice");
a = memory.activate("a"); const unchanged = memory.beginSend("a", a, [], id)!;
b = memory.activate("b"); assert(memory.finishSend(unchanged, "acknowledged", sent));
assert.equal(memory.get("a").draft, ""); assert.equal(memory.get("b").draft, "Private B draft");

// Approved wording is consent for the exact parameters/attachment/recipient generation only.
a = memory.activate("a");
memory.edit("a", { cloudKey: "RECEIPT", cloudValues: { reference: "A-1" } }, a);
const cloud = memory.beginPreview("a", a, true)!;
memory.edit("a", { cloudValues: { reference: "A-2" } }, a);
assert.equal(memory.finishPreview(cloud, "Receipt A-1"), false); assert.equal(composerReady(memory.get("a"), ["reference"]), false);
const currentCloud = memory.beginPreview("a", a, true)!; assert(memory.finishPreview(currentCloud, "Receipt A-2"));
assert(composerReady(memory.get("a"), ["reference"]));
const pdf = { id: "pdf-a", filename: "private-a.pdf", url: "/api/whatsapp/attachments/pdf-a", confirmed: true };
memory.edit("a", { attachment: pdf }, a); assert.equal(memory.get("a").cloudPreview, null);
const withPdf = memory.beginPreview("a", a, true)!; memory.finishPreview(withPdf, "Receipt A-2 with PDF");
assert(composerReady(memory.get("a"), ["reference"]));
b = memory.activate("b"); assert.equal(memory.edit("a", { attachment: pdf }, a), false, "Unmounted attachment callback cannot apply");
a = memory.activate("a"); assert.equal(memory.get("a").attachment?.confirmed, false); assert.equal(memory.get("a").cloudPreview, null);
assert.equal(composerReady(memory.get("a"), ["reference"]), false);
memory.edit("a", { attachment: null, cloudValues: { reference: "" } }, a);
const invalidCloud = memory.beginPreview("a", a, true)!; memory.finishPreview(invalidCloud, "Unexpected server preview");
assert.equal(memory.beginSend("a", a, ["reference"], id), null, "Missing parameters fail closed locally too");

// SPA unmount / Back retains only the correct draft and unresolved write barrier.
memory.discard("a"); memory.edit("a", { draft: "A before Back" }, a);
const pending = memory.beginSend("a", a, [], id)!; memory.leave(a);
a = memory.activate("a"); assert.equal(memory.get("a").draft, "A before Back");
assert.equal(memory.beginSend("a", a, [], id), null, "Back cannot make an in-flight write repeatable");
memory.finishSend(pending, "uncertain"); memory.leave(a); a = memory.activate("a");
assert.equal(memory.get("a").action?.phase, "uncertain"); assert.equal(memory.beginSend("a", a, [], id), null);
assert.equal(memory.discard("a"), false, "Unknown outcome cannot be silently discarded");
memory.reviewedUnknown("a"); const sameRetry = memory.beginSend("a", a, [], id)!;
assert.equal(sameRetry.requestId, pending.requestId, "Explicitly reviewed retry retains the original request ID for identical content");
memory.finishSend(sameRetry, "rejected", undefined, "Synthetic validation rejection");
const rejectedRetry = memory.beginSend("a", a, [], id)!; assert.equal(rejectedRetry.requestId, pending.requestId);
memory.finishSend(rejectedRetry, "rejected"); memory.edit("a", { draft: "A different intentional message" }, a);
const newSend = memory.beginSend("a", a, [], id)!; assert.notEqual(newSend.requestId, pending.requestId);

// Expiry/reset must never revive private text, handoff URLs, previews, or an unlocked unknown send.
now += WHATSAPP_DRAFT_TTL + 1; memory.expire();
assert.equal(memory.get("a").draft, ""); assert.equal(memory.get("a").request, null); assert.equal(memory.get("a").action?.phase, "pending");
assert(!JSON.stringify(memory.getSnapshot()).includes("Private"));
assert(memory.finishSend(newSend, "acknowledged", sent)); assert.equal(memory.get("a").handoff, null);
const expiryPreview = memory.beginPreview("a", a, false)!;
memory.edit("a", { draft: "Expires" }, a); now += WHATSAPP_DRAFT_TTL + 1; memory.expire();
assert.equal(memory.finishPreview(expiryPreview, "Expired result"), false);
memory.edit("a", { draft: "Private BFCache text" }, a); const cachedSend = memory.beginSend("a", a, [], id)!;
memory.leaveDocument(true); assert.equal(memory.get("a").draft, ""); assert.equal(memory.get("a").request, null);
assert.equal(memory.get("a").action?.phase, "pending"); assert(!JSON.stringify(memory.getSnapshot()).includes("Private"));
a = memory.activate("a"); assert.equal(memory.beginSend("a", a, [], id), null);
memory.finishSend(cachedSend, "acknowledged", sent); assert.equal(memory.get("a").handoff, null, "Late success after pagehide cannot restore a private link");
memory.edit("a", { draft: "Old actor text" }, a); const oldActor = memory.beginSend("a", a, [], id)!;
memory.clear(); a = memory.activate("a"); memory.edit("a", { draft: "New context text" }, a);
assert.equal(memory.finishSend(oldActor, "acknowledged", sent), false); assert.equal(memory.get("a").draft, "New context text");
const oldPreview = memory.beginPreview("a", a, false)!; memory.clear(); a = memory.activate("a");
assert.equal(memory.finishPreview(oldPreview, "Old actor preview"), false);
const other = createWhatsAppComposerMemory("session-b-staff-b-scope-b"); assert.deepEqual(other.getSnapshot(), {});
assert.equal(createWhatsAppComposerMemory("").edit("a", { draft: "No session" }, 0), false);

memory.clear(); a = memory.activate("a"); const emptyPreview = memory.beginPreview("a", a, false)!;
now += WHATSAPP_DRAFT_TTL + 1; memory.expire(); assert.equal(memory.finishPreview(emptyPreview, "Private expired empty preview"), false);
assert.equal(memory.get("a").draft, "");

// Upload completions carry a separate epoch: discard/expiry invalidate even the same mounted recipient.
memory.clear(); a = memory.activate("a"); memory.edit("a", { draft: "Upload recipient A" }, a);
const discardedUpload = memory.get("a").attachmentEpoch; memory.uploading("a", true, a, discardedUpload);
assert(memory.discard("a")); assert.equal(memory.edit("a", { attachment: pdf }, a, discardedUpload), false);
memory.uploading("a", true, a, discardedUpload); assert.equal(memory.get("a").uploading, false);
memory.edit("a", { draft: "Expiring upload A" }, a); const expiredUpload = memory.get("a").attachmentEpoch;
memory.uploading("a", true, a, expiredUpload); now += WHATSAPP_DRAFT_TTL + 1; memory.expire();
assert.equal(memory.edit("a", { attachment: pdf }, a, expiredUpload), false); assert.equal(memory.get("a").attachment, null);

memory.clear(); a = memory.activate("a"); const emptyUpload = memory.get("a").attachmentEpoch;
memory.uploading("a", true, a, emptyUpload); now += WHATSAPP_DRAFT_TTL + 1; memory.expire();
assert.equal(memory.edit("a", { attachment: pdf }, a, emptyUpload), false);

// The bounded store never evicts a dirty draft or pending/unknown request to make room.
memory.clear();
for (let i = 0; i < WHATSAPP_DRAFT_LIMIT; i++) { const view = memory.activate(`bounded-${i}`); assert(memory.edit(`bounded-${i}`, { draft: `Draft ${i}` }, view)); }
const overflow = memory.activate("overflow"); assert.equal(memory.edit("overflow", { draft: "Would overflow" }, overflow), false);
assert.equal(memory.beginPreview("overflow", overflow, false), null);
assert.equal(Object.keys(memory.getSnapshot()).length, WHATSAPP_DRAFT_LIMIT); assert.equal(memory.get("bounded-0").draft, "Draft 0");
memory.discard("bounded-0"); assert(memory.edit("overflow", { draft: "Fits now" }, overflow));
assert.equal(Object.keys(memory.getSnapshot()).length, WHATSAPP_DRAFT_LIMIT);
assert.equal(memory.edit("overflow", { draft: "x".repeat(4001) }, overflow), false);
memory.clear(); a = memory.activate("a"); const consent = memory.beginConsent("a", a)!; assert.equal(memory.beginConsent("a", a), null);
b = memory.activate("b"); memory.finishConsent("a", consent, "A consent failed"); assert.equal(memory.get("b").error, "");
console.log("PASS WhatsApp composer: delayed A/B previews, edit generations, synchronous locks, recipient-bound send completion, reviewed retries, cloud/PDF re-consent, SPA Back, expiry/reset/BFCache privacy and bounded session-only recovery.");
