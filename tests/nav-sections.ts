import assert from "node:assert/strict";
import { WORKSPACE_SECTIONS, availableSections, sectionForPath, QUICK_ACTIONS } from "../src/lib/workspace-sections";
import { ROLE_PERMISSIONS } from "../src/lib/permissions";

assert.deepEqual(WORKSPACE_SECTIONS.map(s => [s.id, s.href, s.title]), [
  ["today", "/today", "Today"], ["trips", "/trips", "Trips"], ["customers", "/masters", "Customers"],
  ["suppliers", "/suppliers", "Suppliers"], ["reports", "/reports", "Reports"],
]);
assert.deepEqual(availableSections(ROLE_PERMISSIONS.OWNER).map(s => s.title), ["Today", "Trips", "Customers", "Suppliers", "Reports"]);
const at = (p: string) => sectionForPath(p)?.id;
for (const p of ["/today", "/dashboard", "/work", "/work/service-alerts", "/tasks", "/notifications", "/team-chat"]) assert.equal(at(p), "today", p);
for (const p of ["/trips", "/trips/new", "/cases/x", "/cases", "/ticketing/new", "/ticketing/x/stay", "/visa/x", "/sales", "/online-bookings", "/payments", "/refunds", "/advances", "/documents"]) assert.equal(at(p), "trips", p);
for (const p of ["/masters", "/masters/x", "/customers/x", "/customer-tools", "/email"]) assert.equal(at(p), "customers", p);
assert.equal(at("/suppliers"), "suppliers"); assert.equal(at("/reports/work"), "reports");
for (const p of ["/settings", "/employees", "/audit", "/work/settings", "/checklists"]) assert.equal(at(p), undefined, p);
assert.deepEqual(QUICK_ACTIONS.map(q => [q.label, q.href]), [["New trip", "/trips/new"], ["New customer", "/masters?action=new"], ["New to-do", "/today?action=todo"]]);
for (const s of availableSections(ROLE_PERMISSIONS.VISA_EXECUTIVE)) assert(s.links.some(l => l.href === s.href), "Every staff landing destination is readable");
console.log("Five-section navigation passed.");
