import assert from "node:assert/strict";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Invoked by the existing UI gate, with its authenticated browser and disposable fixture only.
export async function checkSalesToday(page, base, fixture) {
  const runtime = path.resolve(fixture.runtime);
  assert(runtime.startsWith(path.resolve("tests/.runtime") + path.sep));
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(runtime,"test.db")}` } } });
  const prefix = `today-sales-${Date.now()}`, leadIds = [];
  try {
    const customer = await db.customer.findUniqueOrThrow({ where: { id: fixture.customerId } });
    const owner = await db.user.findFirstOrThrow({ where: { email: "review@visual.test" } });
    const common = { customerId: customer.id, branchId: customer.branchId, ownerId: owner.id, source: "Synthetic Today test" };
    const lead = await db.salesLead.create({ data: { ...common, id: `${prefix}-due`, title: "Today exact older enquiry", followUpAt: new Date(Date.now()-86400000), createdAt: new Date(0) } }); leadIds.push(lead.id);
    // More than one Sales page: navigation must fetch this exact enquiry, not guess from the first page.
    for (let i=0;i<51;i++) { const row=await db.salesLead.create({data:{...common,id:`${prefix}-new-${i}`,title:`Unscheduled ${i}`}}); leadIds.push(row.id); }
    await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    const queue = page.getByRole("region", { name: "Attention queue" });
    await queue.getByLabel("Work area", { exact: true }).selectOption("sales");
    const item = queue.locator("article").filter({ hasText: lead.title });
    // A transient exact-record failure must not make Reload silently settle on page one.
    let interrupted = false;
    const interruptExact = route => {
      const url = new URL(route.request().url());
      if (!interrupted && route.request().method() === "GET" && url.searchParams.get("leadId") === lead.id) {
        interrupted = true; return route.abort("failed");
      }
      return route.fallback();
    };
    await page.route("**/api/sales*", interruptExact);
    await item.getByRole("button", { name: "Open enquiry", exact: true }).click();
    await page.waitForURL(`**/sales?lead=${lead.id}`);
    await page.getByText("Enquiries could not be loaded. Retry to see the latest records.", { exact: true }).waitFor();
    assert(interrupted, "The off-page exact-record read really was interrupted");
    await page.unroute("**/api/sales*", interruptExact);
    await page.getByRole("button", { name: "Reload latest status", exact: true }).click();
    await page.getByRole("heading", { name: lead.title, exact:true }).waitFor();
    await page.getByText("Update stage / follow-up", { exact:true }).click();
    await page.getByLabel("Next follow-up", { exact:true }).fill("2099-12-01T12:00");
    const saved = page.waitForResponse(r=>new URL(r.url()).pathname==="/api/sales"&&r.request().method()==="POST");
    await page.getByRole("button", { name:"Save stage / follow-up",exact:true }).click();
    assert((await saved).ok());
    await page.getByText("Saved. The latest enquiry record is shown below.",{exact:true}).waitFor();
    await page.goBack({ waitUntil:"networkidle" });
    await page.waitForURL("**/dashboard");
    await queue.getByRole("button", { name:"Refresh",exact:true }).click();
    await queue.locator("article").filter({hasText:lead.title}).waitFor({state:"hidden"});
    assert.equal((await db.salesLead.findUniqueOrThrow({where:{id:lead.id}})).followUpAt.getFullYear(),2099);

    const accepted=await db.salesLead.create({data:{...common,id:`prefix-${prefix}-accepted`,title:"Today accepted quote review",stage:"QUOTED"}}); leadIds.push(accepted.id);
    await db.salesQuote.create({data:{leadId:accepted.id,version:1,state:"ACCEPTED",items:"[]",terms:"Synthetic only",totalMinor:10000,costMinor:8000,expiresAt:new Date("2099-12-01"),createdBy:owner.id}});
    await queue.getByRole("button", {name:"Refresh",exact:true}).click();
    await queue.locator("article").filter({hasText:accepted.title}).getByRole("button",{name:"Review accepted quote",exact:true}).click();
    await page.getByRole("heading",{name:accepted.title,exact:true}).waitFor();
    await page.getByRole("heading",{name:"Quote v1 · Accepted",exact:true}).waitFor();
    const converted=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/sales"&&r.request().method()==="POST");
    await page.getByRole("button",{name:"Create CRM booking from accepted quote",exact:true}).click();
    assert((await converted).ok());
    await page.getByRole("link",{name:"Open linked booking",exact:true}).waitFor();
    assert.equal((await db.salesLead.findUniqueOrThrow({where:{id:accepted.id}})).stage,"WON");
    await page.goto(`${base}/dashboard`,{waitUntil:"networkidle"});
    assert.equal(await queue.locator("article").filter({hasText:accepted.title}).count(),0);
    // A guessed or revoked exact-record link must not reopen retained enquiry details.
    await page.goto(`${base}/sales?lead=unavailable-${prefix}`,{waitUntil:"networkidle"});
    await page.getByText("This enquiry is no longer available in your workspace.",{exact:true}).waitFor();
    assert.equal(await page.getByRole("heading",{name:accepted.title,exact:true}).count(),0);
    console.log("Sales Today browser: interrupted off-page exact handoff + retry, reschedule + Back/refresh removal, accepted conversion removal, unavailable link.");
  } finally {
    const quotes=await db.salesQuote.findMany({where:{leadId:{in:leadIds}},select:{bookingId:true}});
    await db.salesQuote.deleteMany({where:{leadId:{in:leadIds}}});
    await db.salesLead.deleteMany({where:{id:{in:leadIds}}});
    await db.booking.deleteMany({where:{id:{in:quotes.flatMap(q=>q.bookingId?[q.bookingId]:[])}}});
    await db.$disconnect();
  }
}
