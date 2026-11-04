import assert from "node:assert/strict";
import { profileCompleteness, passportWarning, type CompletenessTraveller } from "../src/lib/profile-completeness";

const full: CompletenessTraveller = {
  id: "t1", fullName: "Asha Rao", dateOfBirth: "1990-02-01", gender: "FEMALE", nationality: "India",
  details: { phone: "9876543210", email: "", emergencyName: "Ravi Rao", emergencyPhone: "9123456780" },
  legacyPassport: null,
  identities: [{ kind: "PASSPORT", primaryPassport: true, expiryDate: "2031-05-01", fileDocumentId: null }],
};
const docs = [{ travellerId: "t1", uploadedAt: "2026-10-01T00:00:00Z" }];

assert.deepEqual(profileCompleteness(full, docs), { filled: 10, total: 10, missing: [] });
const bare: CompletenessTraveller = { ...full, details: { phone: "9876543210" }, identities: [], legacyPassport: null };
assert.deepEqual(profileCompleteness(bare, []).missing, ["Passport number", "Passport expiry", "Emergency contact name", "Emergency contact phone", "Identity document"]);
assert.equal(profileCompleteness(bare, []).filled, 5);
// Legacy passport on the traveller record counts; an upload for another traveller does not.
const legacy: CompletenessTraveller = { ...full, identities: [], legacyPassport: { expiryDate: "2030-01-01" } };
assert.deepEqual(profileCompleteness(legacy, [{ travellerId: "other", uploadedAt: "2026-10-01T00:00:00Z" }]).missing, ["Identity document"]);
// A document record that was requested but never uploaded does not count; an identity linked to a file does.
assert.deepEqual(profileCompleteness(full, [{ travellerId: "t1", uploadedAt: null }]).missing, ["Identity document"]);
assert.deepEqual(profileCompleteness({ ...full, identities: [{ ...full.identities[0], fileDocumentId: "d1" }] }, []).missing, []);
// Phone OR email is enough for contact.
assert.equal(profileCompleteness({ ...full, details: { ...full.details, phone: "", email: "a@b.in" } }, docs).filled, 10);
assert.deepEqual(profileCompleteness({ ...full, details: { ...full.details, phone: "", email: "" } }, docs).missing, ["Phone or email"]);
assert.deepEqual(profileCompleteness({ ...full, dateOfBirth: "", gender: "" }, docs).missing, ["Date of birth", "Gender"]);

const today = "2026-11-04";
assert.equal(passportWarning("2026-10-01", today), "EXPIRED");
assert.equal(passportWarning("2027-03-01", today), "SOON");
assert.equal(passportWarning("2027-06-01", today), null);
assert.equal(passportWarning("", today), null);
console.log("Profile completeness passed.");
