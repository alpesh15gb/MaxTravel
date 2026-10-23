import assert from "node:assert/strict";
import { REPORT_CATALOGUE, REPORT_DATE_PRESETS, indiaDay, reportDatePreset, reportFilterQuery, reportCurrency, reportProductLabel } from "../src/lib/report-workspace";
let passed = 0;
function check(name: string, fn: () => void) { fn(); console.log(`✓ ${name}`); passed++; }
check("India calendar crosses midnight at 18:30 UTC, including year rollover", () => {
 assert.equal(indiaDay(new Date("2026-12-31T18:29:59Z")), "2026-12-31");
 assert.equal(indiaDay(new Date("2026-12-31T18:30:00Z")), "2027-01-01");
});
check("Inclusive quick ranges and leap-month boundaries", () => {
 assert.deepEqual(reportDatePreset("last7", "receipts", null, new Date("2026-10-23T12:00Z")), { from: "2026-10-17", to: "2026-10-23" });
 assert.deepEqual(reportDatePreset("previousMonth", "sales", null, new Date("2024-03-01T12:00Z")), { from: "2024-02-01", to: "2024-02-29" });
 assert.deepEqual(reportDatePreset("month", "sales", null, new Date("2026-12-31T18:30Z")), { from: "2027-01-01", to: "2027-01-01" });
});
check("All presets obey end-not-future and maximum 366 inclusive days", () => {
 for (const when of ["2026-01-01T00:00Z", "2024-03-01T00:00Z", "2026-12-31T18:30Z"]) for (const report of REPORT_CATALOGUE) for (const preset of REPORT_DATE_PRESETS) {
  const range = reportDatePreset(preset.key, report.key, null, new Date(when))!;
  assert(range.to <= indiaDay(new Date(when))); assert(range.from <= range.to);
  assert((Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1 <= 366);
 }
});
check("Statement presets clamp to preserved history; unavailable periods are disabled", () => {
 const now = new Date("2026-10-23T12:00Z"), cutoff = "2026-10-20T00:00:00+05:30";
 assert.deepEqual(reportDatePreset("month", "statement", cutoff, now), { from: "2026-10-20", to: "2026-10-23" });
 assert.equal(reportDatePreset("previousMonth", "supplier-statement", cutoff, now), null);
 assert.deepEqual(reportDatePreset("month", "receipts", cutoff, now), { from: "2026-10-01", to: "2026-10-23" });
 assert.deepEqual(reportDatePreset("previousMonth", "ageing", "2026-09-01T00:00:00+05:30", now), { from: "2026-09-30", to: "2026-09-30" });
 assert.equal(reportDatePreset("previousMonth", "ageing", cutoff, now), null);
});
const filters = { report: "sales", from: "2026-10-01", to: "2026-10-23", customerId: "customer", supplierId: "supplier", ownerId: "staff", status: "CONFIRMED" };
check("Normalized queries include only relevant filters and encode one as-of date", () => {
 const sales = new URLSearchParams(reportFilterQuery(filters));
 assert.equal(sales.get("ownerId"), "staff"); assert.equal(sales.get("supplierId"), null);
 const receipts = new URLSearchParams(reportFilterQuery({ ...filters, report: "receipts" }));
 assert.equal(receipts.get("ownerId"), null); assert.equal(receipts.get("status"), null); assert.equal(receipts.get("customerId"), "customer");
 const balance = new URLSearchParams(reportFilterQuery({ ...filters, report: "ageing" }));
 assert.equal(balance.get("from"), balance.get("to"));
 const supplier = new URLSearchParams(reportFilterQuery({ ...filters, report: "supplier-statement" }));
 assert.equal(supplier.get("customerId"), null); assert.equal(supplier.get("supplierId"), "supplier");
 assert.equal(new URLSearchParams(reportFilterQuery({ ...filters, report: "supplier-payables" })).get("supplierId"), null);
});
check("Dirty controls do not mutate the applied query snapshot", () => {
 const applied = reportFilterQuery(filters); const edited = reportFilterQuery({ ...filters, status: "" });
 assert.notEqual(edited, applied); assert.equal(new URLSearchParams(applied).get("status"), "CONFIRMED");
 assert.equal(reportFilterQuery({ ...filters, supplierId: "irrelevant change" }), applied);
});
check("All report definitions have explicit basis, honest currency and normalized product facts", () => {
 assert.equal(new Set(REPORT_CATALOGUE.map(r => r.key)).size, 9);
 assert(REPORT_CATALOGUE.every(r => r.basis && r.group && r.hint));
 assert.equal(reportCurrency("operations"), "All currencies · no monetary totals");
 assert.equal(reportCurrency("sales"), "INR");
 assert.equal(reportProductLabel(" hotel "), "Hotel"); assert.equal(reportProductLabel("flight"), "Flight");
 assert.equal(reportProductLabel(null), "Booking (product not recorded)");
 assert.equal(reportProductLabel("UNKNOWN"), "Booking (product not recorded)");
});
console.log(`${passed} reporting workspace checks passed.`);
