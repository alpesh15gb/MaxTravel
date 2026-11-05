import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { initializeReferenceData } from "../src/lib/bootstrap";
import { stopFixtureChild, within } from "./fixture-lifecycle.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "crm-access-review-"));
const database = `file:${path.join(directory, "fixture.db").replaceAll("\\", "/")}`;
const secret = randomBytes(48).toString("hex");
const passwordHash = "synthetic-not-a-real-password";
const databaseClient = new PrismaClient({ datasources: { db: { url: database } } });
let server: ReturnType<typeof spawn> | undefined;
let logs = "";
let checks = 0;
type Payload = { rows: {id:string}[]; money: {currency:string;dueMinor:number}|null; profit: {marginMinor:number|null}|null; account: {supplierCostMinor:number|null;marginMinor:number|null}|null; releaseDueMinor:number|null; employeeId:string; bookingId:string; revision:string; actorContext:string; internalFinance:boolean };
function check(label: string, condition: unknown) {
  assert(condition, label);
  checks++;
  console.log(`PASS ${label}`);
}
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
async function actor(id: string) {
  const employee = await databaseClient.user.findUniqueOrThrow({ where: { id } });
  const session = await databaseClient.staffSession.create({ data: { id: randomBytes(16).toString("hex"), userId: id, expiresAt: new Date(Date.now() + 3600000), agent: "Isolated access review" } });
  const token = await new SignJWT({ id, sessionId: session.id, authVersion: createHash("sha256").update(employee.passwordHash).digest("hex") }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
  return `tos_session=${token}`;
}
async function request(cookie: string | null, route: string, body?: object, headers: Record<string,string> = {}) {
  const response = await fetch(origin + route, { method: body ? "POST" : "GET", redirect: "manual", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let json = {} as Payload;
  try { json = JSON.parse(text); } catch {}
  return { response, text, json };
}
try {
  await writeFile(path.join(directory, "fixture.db"), "");
  await writeFile(path.join(directory, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await cp("prisma/migrations", path.join(directory, "migrations"), { recursive: true });
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", path.join(directory, "schema.prisma")], { env: { ...process.env, DATABASE_URL: database }, stdio: "pipe" });
  await databaseClient.$transaction(initializeReferenceData);
  const roles = new Map((await databaseClient.role.findMany()).map(role => [role.key, role.id]));
  for (const branch of ["a", "b"]) await databaseClient.branch.create({ data: { id: branch, code: branch, name: `Synthetic ${branch}`, city: "Synthetic" } });
  const people = [["owner", "OWNER", "a"], ["ticket", "TICKETING_EXECUTIVE", "a"], ["visa", "VISA_EXECUTIVE", "a"], ["travel", "TRAVEL_EXECUTIVE", "a"], ["sales", "SALES_EXECUTIVE", "a"], ["manager", "BRANCH_MANAGER", "a"], ["visa-manager", "VISA_MANAGER", "a"], ["accounts", "ACCOUNTS", "a"], ["hr", "HR", "a"], ["reader", "READ_ONLY", "a"], ["outside", "TRAVEL_EXECUTIVE", "b"]];
  for (const [id, role, branch] of people) await databaseClient.user.create({ data: { id, employeeCode: id, name: `Synthetic ${id}`, email: `${id}@example.test`, phone: "", passwordHash, roleId: roles.get(role)!, branchId: branch, salary: 876543.21, bankAccount: "AUDIT_EMPLOYEE_BANK_SECRET" } });
  await databaseClient.supplier.create({ data: { id: "supplier", name: "Synthetic Supplier" } });
  for (const id of ["ticket", "visa", "travel", "sales", "outside"]) {
    const branchId = id === "outside" ? "b" : "a";
    await databaseClient.customer.create({ data: { id: `customer-${id}`, code: `C-${id}`, name: `Synthetic customer ${id}`, phone: "+919000000001", city: "Synthetic", assignedToId: id, branchId } });
    await databaseClient.serviceCase.create({ data: { id: `trip-${id}`, caseNo: `MAX-${id}`, title: `Synthetic trip ${id}`, customerId: `customer-${id}`, branchId, ownerId: id, service: "FLIGHT" } });
    await databaseClient.booking.create({ data: { id: `booking-${id}`, bookingNo: `BK-${id}`, customerId: `customer-${id}`, serviceCaseId: `trip-${id}`, ownerId: id, branchId, supplierId: "supplier", status: "TICKETED", fare: 19000, sellingPrice: 19000, supplierCost: 11000, supplierCostConfirmed: true, currency: "INR" } });
    const due = await databaseClient.supplierDue.create({ data: { supplierId: "supplier", bookingId: `booking-${id}`, description: `Synthetic due ${id}`, amount: 123.45, dueDate: new Date(), paidAmount: 20 } });
    await databaseClient.supplierSettlement.create({ data: { dueId: due.id, amount: 20, reference: `SUPPLIER_REFERENCE_${id}`, note: `SUPPLIER_PRIVATE_NOTE_${id}`, method: "NEFT", recordedById: "owner", requestKey: `synthetic-${id}` } });
    await databaseClient.document.create({ data: { id: `passport-${id}`, docNo: `DOC-${id}`, docType: "Passport", customerId: `customer-${id}`, sensitive: true, storagePath: path.join(directory, `${id}.pdf`) } });
  }
  await databaseClient.settings.upsert({ where: { key: "financialJournal.cutover" }, create: { key: "financialJournal.cutover", value: new Date(Date.now() - 86400000).toISOString() }, update: { value: new Date(Date.now() - 86400000).toISOString() } });
  for (const id of ["sales", "ticket"]) {
    await databaseClient.salesLead.create({data:{id:`lead-${id}`,customerId:`customer-${id}`,serviceCaseId:`trip-${id}`,branchId:"a",ownerId:id,title:"Synthetic quotation",source:"Fixture",quotes:{create:{version:1,items:JSON.stringify([{description:"Synthetic travel service",quantity:1,priceMinor:4512345,costMinor:3456789}]),terms:"Synthetic terms",totalMinor:4512345,costMinor:3456789,expiresAt:new Date(Date.now()+86400000),state:"PUBLISHED",createdBy:"owner"}}}});
  }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next", DATABASE_URL: database, JWT_SECRET: secret, APP_ORIGIN: origin, UPLOAD_ROOT: path.join(directory, "uploads"), CRM_DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"), CRM_REQUIRE_MFA: "false", SMTP_HOST: "", SMTP_FROM: "", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" } });
  server.stdout!.on("data", chunk => logs += chunk);
  server.stderr!.on("data", chunk => logs += chunk);
  await within((async () => {
    while (true) {
      assert(server!.exitCode === null, logs);
      try { if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  })(), 60000, "access fixture startup");
  const cookies = new Map<string, string>();
  for (const [id] of people) cookies.set(id, await actor(id));
  const as = (id: string, route: string, body?: object) => request(cookies.get(id)!, route, body);
  check("Anonymous trip API denied", (await request(null, "/api/trips")).response.status === 401);
  for (const id of ["ticket", "visa", "travel", "sales"]) {
    const list = await as(id, "/api/trips");
    check(`${id}: only assigned trip listed`, list.response.status === 200 && list.json.rows.length === 1 && list.json.rows[0].id === `trip-${id}`);
    check(`${id}: another branch trip denied`, (await as(id, "/api/trips/trip-outside")).response.status === 404);
    check(`${id}: settings mutation denied`, (await as(id, "/api/settings", {})).response.status === 403);
    check(`${id}: export denied`, (await as(id, "/api/export?entity=customers")).response.status === 403);
    check(`${id}: employee creation denied`, (await as(id, "/api/employees", {})).response.status === 403);
  }
  for (const id of ["ticket", "visa", "travel"]) {
    const trip = await as(id, `/api/trips/trip-${id}`);
    check(`${id}: trip money/profit withheld`, trip.json.money === null && trip.json.profit === null);
    check(`${id}: finance endpoint denied`, (await as(id, `/api/cases/trip-${id}/finance`)).response.status === 403);
    const supplier = await as(id, "/suppliers");
    check(`${id}: supplier contact page omits financial amounts, references and notes`, supplier.response.status === 200 && supplier.text.includes("Supplier contacts") && !supplier.text.includes(`SUPPLIER_PRIVATE_NOTE_${id}`) && !supplier.text.includes(`SUPPLIER_REFERENCE_${id}`) && !supplier.text.includes("123.45"));
    check(`${id}: other branch supplier notes withheld`, !supplier.text.includes("SUPPLIER_PRIVATE_NOTE_outside"));
    check(`${id}: supplier payment mutation denied`, (await as(id, "/api/suppliers/dues", {})).response.status === 403);
  }
  const sales = await as("sales", "/api/trips/trip-sales");
  check("Sales: customer balance preserved without profit", sales.json.profit === null && sales.json.money?.dueMinor === 1900000);
  check("Sales: internal sales report denied", (await as("sales", "/api/reports/accounts?report=sales")).response.status === 403);
  check("Sales: customer ageing report retained", (await as("sales", "/api/reports/accounts?report=ageing")).response.status === 200);
  check("Sales: agency overview denied", (await as("sales", "/api/reports")).response.status === 403);
  const salesCustody = await as("sales", "/api/bookings/booking-sales/custody");
  check("Sales: booking custody excludes supplier cost and profit", salesCustody.json.account?.supplierCostMinor === null && salesCustody.json.account.marginMinor === null && !salesCustody.json.internalFinance);
  const salesBooking = await as("sales", "/ticketing/booking-sales");
  check("Sales: booking page excludes profit and private fare breakdown", salesBooking.response.status === 200 && !salesBooking.text.includes("Expected gross profit:") && !salesBooking.text.includes("11000"));
  check("Sales: report XLSX export denied", (await as("sales", "/api/reports/accounts?report=sales&format=xlsx")).response.status === 403);
  const salesQuote = await as("sales", "/api/sales?leadId=lead-sales");
  check("Sales: quotation customer prices retained without total or line-item supplier cost", salesQuote.response.status === 200 && salesQuote.text.includes('"totalMinor":4512345') && salesQuote.text.includes('"costMinor":null') && !salesQuote.text.includes("3456789"));
  const manager = await as("manager", "/api/trips");
  check("Branch manager: branch trips only", manager.json.rows.length === 4 && !manager.text.includes("MAX-outside"));
  const visaManager = await as("visa-manager", "/api/trips/trip-sales");
  check("Visa manager: no flight money or internal profit", visaManager.response.status === 200 && visaManager.json.money?.dueMinor === 0 && visaManager.json.profit === null);
  check("HR: customer/trip API denied", (await as("hr", "/api/trips")).response.status === 403);
  const readOnlyList = await as("reader", "/api/trips");
  check("Read-only: no unassigned trips visible", readOnlyList.response.status === 200 && readOnlyList.json.rows.length === 0);
  const accounts = await as("accounts", "/api/trips");
  check("Accounts: agency financial access retained", accounts.response.status === 200 && accounts.json.rows.length === 5 && accounts.text.includes("MAX-outside"));
  const reader = await as("reader", "/api/trips/trip-outside");
  check("Read-only: other branch trip denied", reader.response.status === 404);
  check("Read-only: global audit denied", (await as("reader", "/api/audit")).response.status === 403);
  check("Read-only: finance reports denied", (await as("reader", "/api/reports/accounts?report=ageing")).response.status === 403);
  for (const id of ["manager"]) {
    const employees = await as(id, "/employees");
    check(`${id}: employee salary/bank values withheld`, employees.response.status === 200 && !employees.text.includes("AUDIT_EMPLOYEE_BANK_SECRET") && !employees.text.includes("876543.21"));
  }
  check("Ticketing: sensitive passport URL denied", (await as("ticket", "/api/documents/passport-ticket/file", {})).response.status === 403);
  check("Visa: assigned sensitive passport URL allowed", (await as("visa", "/api/documents/passport-visa/file", {})).response.status === 200);
  check("Travel: assigned sensitive passport URL allowed", (await as("travel", "/api/documents/passport-travel/file", {})).response.status === 200);
  check("Travel: unassigned sensitive passport URL denied", (await as("travel", "/api/documents/passport-outside/file", {})).response.status === 403);
  const custody = await as("ticket", "/api/bookings/booking-ticket/custody");
  check("Ticketing: operational release balance retained without internal finance", custody.response.status === 200 && custody.json.account === null && custody.json.releaseDueMinor === 1900000);
  const created = await as("hr", "/api/employees", { name: "Synthetic new reader", email: "new-reader@example.test", password: "Synthetic-Reader-Password-2026!", roleId: roles.get("READ_ONLY"), branchId: "a" });
  check("HR: account creation denied without partial writes", created.response.status === 403 && await databaseClient.user.count({where:{email:"new-reader@example.test"}}) === 0);
  for (const change of [{roleId:roles.get("READ_ONLY")},{branchId:"b"},{email:"replacement@example.test"},{active:false},{password:"Synthetic-Reset-Password-2026!"}]) {
    check("HR: login/access changes rejected", (await as("hr", "/api/employees", {id:"ticket",...change})).response.status === 403);
  }
  check("HR: ordinary payroll/profile update retained", (await as("hr", "/api/employees", {id:"ticket",phone:"9000000999",salary:25000})).response.status === 200);
  check("HR: protected administrator edit rejected", (await as("hr", "/api/employees", {id:"owner",name:"Unauthorized change"})).response.status === 403);
  const ownerTrip = await as("owner", "/api/trips/trip-outside");
  check("Owner: internal trip profit retained", ownerTrip.json.profit?.marginMinor === 800000);
  const managerSuppliers = await as("manager", "/suppliers");
  check("Branch manager: branch-only supplier finance retained", managerSuppliers.response.status === 200 && managerSuppliers.text.includes("SUPPLIER_PRIVATE_NOTE_ticket") && !managerSuppliers.text.includes("SUPPLIER_PRIVATE_NOTE_outside"));
  await databaseClient.traveller.create({ data: { id: "traveller-ticket", customerId: "customer-ticket", fullName: "Synthetic passenger", relation: "SELF" } });
  const manualBooking = await as("ticket", "/api/bookings", { requestKey: randomUUID(), customerId: "customer-ticket", serviceCaseId: "trip-ticket", product: "FLIGHT", travellerIds: ["traveller-ticket"], sector: "BOM-DEL", travelScope: "DOMESTIC", fare: 10000, supplierCost: 1, supplierCostConfirmed: true });
  check("Ticketing: internal supplier price/confirmation rejected", manualBooking.response.status === 403);
  check("Rejected booking leaves no source writes", await databaseClient.booking.count({where:{customerId:"customer-ticket"}}) === 1);
  const customerBooking = await as("ticket", "/api/bookings", { requestKey: randomUUID(), customerId: "customer-ticket", serviceCaseId: "trip-ticket", product: "FLIGHT", travellerIds: ["traveller-ticket"], sector: "BOM-DEL", travelScope: "DOMESTIC", fare: 10000 });
  check("Ticketing: customer selling-price entry retained", customerBooking.response.status === 200);
  const persistedBooking = await databaseClient.booking.findUniqueOrThrow({ where: { id: customerBooking.json.bookingId } });
  check("Staff booking supplier cost remains unconfirmed", persistedBooking.supplierCost === 0 && persistedBooking.supplierCostConfirmed === false && persistedBooking.sellingPrice === 10000);
  const forgedConfirmation = await as("ticket", "/api/bookings", { requestKey: randomUUID(), customerId: "customer-ticket", serviceCaseId: "trip-ticket", product: "FLIGHT", travellerIds: ["traveller-ticket"], sector: "BOM-DEL", travelScope: "DOMESTIC", fare: 10000, supplierCostConfirmed:true });
  check("Ticketing: confirming a zero supplier cost also denied", forgedConfirmation.response.status === 403);
  const ownerBooking = await as("owner", "/api/bookings", { requestKey: randomUUID(), customerId: "customer-ticket", serviceCaseId: "trip-ticket", product: "FLIGHT", travellerIds: ["traveller-ticket"], sector: "BOM-DEL", travelScope: "DOMESTIC", fare: 10000, supplierCost:8000, supplierCostConfirmed:true });
  check("Owner: internal pricing and confirmation retained", ownerBooking.response.status === 200 && (await databaseClient.booking.findUniqueOrThrow({where:{id:ownerBooking.json.bookingId}})).supplierCostConfirmed);
  await databaseClient.booking.update({where:{id:ownerBooking.json.bookingId},data:{ownerId:"ticket"}});
  const statusUpdate = await as("ticket", "/api/bookings/status", {bookingId:ownerBooking.json.bookingId,status:"ON_HOLD"});
  check("Booking status changes cannot leak stored supplier cost or markup", statusUpdate.response.status === 200 && !statusUpdate.text.includes("supplierCost") && !statusUpdate.text.includes("markup") && !statusUpdate.text.includes("8000"));
  await databaseClient.serviceCase.create({data:{id:"trip-usd",caseNo:"MAX-USD",title:"Synthetic USD trip",customerId:"customer-sales",branchId:"a",ownerId:"sales",service:"FLIGHT"}});
  await databaseClient.booking.create({data:{id:"booking-usd",bookingNo:"BK-USD",customerId:"customer-sales",serviceCaseId:"trip-usd",branchId:"a",ownerId:"sales",sellingPrice:1000,currency:"USD"}});
  const foreignBalance = await as("sales", "/api/trips/trip-usd");
  check("Customer balances retain the source currency without exposing costs", foreignBalance.json.money?.currency === "USD" && foreignBalance.json.money.dueMinor === 100000 && foreignBalance.json.profit === null);
  const master = await as("owner", "/api/masters/customer-ticket");
  const assignedCustomer = await request(cookies.get("owner")!, "/api/masters/customer-ticket", {action:"ASSIGN",requestKey:randomUUID(),baseRevision:master.json.revision,data:{assignedToId:"reader"}}, {"x-master-context":master.json.actorContext});
  check("Owner can grant read-only customer access through the existing assignment API", assignedCustomer.response.status === 200);
  const assignedReadOnly = await as("reader", "/api/trips");
  check("Read-only: explicitly assigned trip can be read without money", assignedReadOnly.response.status === 200 && assignedReadOnly.json.rows.length === 1 && assignedReadOnly.json.rows[0].id === "trip-ticket" && !assignedReadOnly.text.includes('"marginMinor":800000'));
  const readOnlyTrip = await as("reader", "/api/trips/trip-ticket");
  check("Read-only: trip quotation amounts remain hidden", readOnlyTrip.response.status === 200 && !readOnlyTrip.text.includes("4512345") && !readOnlyTrip.text.includes("3456789"));
  check("Read-only: other customers remain unavailable", (await as("reader", "/api/trips/trip-outside")).response.status === 404);
  const readOnlyBooking = await as("reader", "/api/bookings/booking-ticket/custody");
  check("Read-only: assigned booking access does not disclose financial balance", readOnlyBooking.response.status === 200 && readOnlyBooking.json.account === null && readOnlyBooking.json.releaseDueMinor === null);
  await databaseClient.customer.update({where:{id:"customer-ticket"},data:{assignedToId:"ticket"}});
  check("Revoking customer assignment removes access on the existing read-only session", (await as("reader", "/api/trips/trip-ticket")).response.status === 404);
  const newEntry = await as("ticket", "/ticketing/new?case=trip-ticket");
  check("Staff entry form shows customer price instead of supplier cost controls", newEntry.response.status === 200 && newEntry.text.includes("Customer selling price (INR)") && !newEntry.text.includes("Known supplier cost (INR)") && !newEntry.text.includes("Markup (INR)"));
  const hrPage = await as("hr", "/employees");
  check("HR screen omits account creation and status controls", hrPage.response.status === 200 && !hrPage.text.includes("+ New employee") && !hrPage.text.includes(">Deactivate<"));
  if (process.argv.includes("--browser")) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({headless:true});
    try {
      for (const id of ["ticket", "hr", "sales"]) {
        const context = await browser.newContext({viewport:{width:375,height:812}});
        try {
          await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          await context.addCookies([{name:"tos_session",value:cookies.get(id)!.slice("tos_session=".length),url:origin}]);
          const page = await context.newPage();
          if (id === "ticket") {
            await page.goto(origin + "/ticketing/new?case=trip-ticket");
            check("Browser: staff customer-price field exists without private pricing controls", await page.getByLabel("Customer selling price (INR)").count() === 1 && await page.getByLabel("Markup (INR)").count() === 0 && await page.getByLabel("Known supplier cost (INR)").count() === 0);
          } else if (id === "hr") {
            await page.goto(origin + "/employees");
            check("Browser: HR cannot create logins", await page.getByRole("button",{name:"+ New employee",exact:true}).count() === 0);
            await page.locator("tr").filter({has:page.getByRole("link",{name:"Synthetic ticket",exact:true})}).getByRole("button",{name:"Edit",exact:true}).click();
            const dialog = page.getByRole("dialog");
            check("Browser: HR security fields are immutable", await dialog.getByLabel("Email *").evaluate(element => (element as HTMLInputElement).readOnly) && await dialog.getByLabel("Role *").isDisabled() && await dialog.getByLabel("Branch *").isDisabled());
            await dialog.getByLabel("Annual salary (INR)").fill("26000");
            await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
            await dialog.waitFor({state:"hidden"});
            check("Browser: HR payroll save remains functional", (await databaseClient.user.findUniqueOrThrow({where:{id:"ticket"}})).salary === 26000);
          } else {
            await page.goto(origin + "/trips/trip-sales");
            check("Browser: Sales sees customer balance, not profit", await page.getByText("Customer balance",{exact:true}).isVisible() && await page.locator('[aria-label="Profit or loss"]').count() === 0);
            await page.goto(origin + "/reports");
            check("Browser: customer report library omits sales/margin and overview", await page.locator('option[value="sales"]').count() === 0 && await page.locator('option[value="overview"]').count() === 0);
          }
          check(`Browser: ${id} screen fits phone width`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  await databaseClient.user.update({where:{id:"owner"},data:{roleId:roles.get("READ_ONLY")}});
  check("Role reduction takes effect on an existing signed session", (await as("owner", "/api/trips/trip-outside")).response.status === 404);
  console.log(`Staff authorization passed: ${checks} HTTP/browser checks with isolated accounts/database; no external services.`);
} finally {
  if (server) await stopFixtureChild(server);
  await databaseClient.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
