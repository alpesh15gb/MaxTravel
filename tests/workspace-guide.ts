import assert from "node:assert/strict";
import { availableWorkActions, screenGuide } from "../src/lib/workspace-guide";
import { reportLocationFilters } from "../src/lib/report-workspace";

assert.deepEqual(availableWorkActions([]),[],"No operations are offered without permissions");
assert(!availableWorkActions(["payment:record"]).some(action=>action.id==="payment"),"A write permission cannot bypass the destination read guard");
assert(availableWorkActions(["payment:view","payment:record"]).some(action=>action.id==="payment"));
assert(!availableWorkActions(["customer:create","customer:view"]).some(action=>action.id==="enquiry"),"Quotation entry requires enquiry editing access too");
assert(availableWorkActions(["customer:create","customer:view","customer:edit"]).some(action=>action.href==="/sales?action=new"));
assert(availableWorkActions(["ticketing:create"]).some(action=>action.href==="/ticketing/new?product=HOTEL"),"Manual hotel entry is a first-class workflow");
for(const route of ["/dashboard","/work","/sales","/customers","/customers/test","/tasks","/ticketing","/ticketing/new","/ticketing/test","/ticketing/test/stay","/visa","/visa/new","/visa/test","/visa-requirements","/documents","/incoming-documents","/whatsapp","/payments","/advances","/refunds","/suppliers","/reports","/online-bookings","/employees","/employees/test","/customer-tools","/checklists","/audit","/travel-packages","/settings","/account-security","/notifications"]){assert(screenGuide(route),`Screen orientation exists for ${route}`);}
assert.equal(screenGuide("/ticketing/new")?.title,"New booking","Specific routes take precedence over record patterns");
assert.deepEqual(reportLocationFilters({report:"sales",from:"2026-10-01",to:"2026-10-30",ownerId:"staff-1",status:"CONFIRMED"}),{report:"sales",from:"2026-10-01",to:"2026-10-30",ownerId:"staff-1",status:"CONFIRMED"});
assert.deepEqual(reportLocationFilters({report:"unknown",from:"2026-02-31",to:["2026-10-30"],customerId:"<script>",supplierId:"../bad"}),{},"Invalid dates, array values and unsafe location inputs do not hydrate report criteria");
console.log("Workspace entry guards, screen coverage and report location criteria passed.");
