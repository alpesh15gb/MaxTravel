import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

// Existing UI-gate browser + disposable review database only. Never launches a browser itself.
export async function checkCustomerSalesHistory(page, base, fixture) {
  const runtime = path.resolve(fixture.runtime);
  assert(runtime.startsWith(path.resolve("tests/.runtime") + path.sep), "Only the disposable UI fixture may be seeded");
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(runtime, "test.db")}` } } });
  const prefix = `customer-history-${Date.now()}`;
  const customerIds = [], leadIds = [];
  const originalViewport = page.viewportSize();
  const shots = path.resolve("test-artifacts/ui/customer-sales-history");
  let owner, deniedRole;
  try {
    await mkdir(shots, { recursive: true });
    owner = await db.user.findFirstOrThrow({ where: { email: "review@visual.test" } });
    const source = await db.customer.findUniqueOrThrow({ where: { id: fixture.customerId } });
    for (const suffix of ["history", "empty", "same-name"]) {
      const customer = await db.customer.create({ data: { id: `${prefix}-${suffix}`, code: `${prefix}-${suffix}`, name: "Synthetic same-name customer", phone: "", city: "Synthetic", branchId: source.branchId, assignedToId: owner.id } });
      customerIds.push(customer.id);
    }
    const [customerId, emptyId, sameNameId] = customerIds;
    const common = { branchId: source.branchId, ownerId: owner.id, source: "Isolated customer history browser fixture" };
    const lead = await db.salesLead.create({ data: { ...common, customerId, id: `${prefix}-exact`, title: "Family holiday enquiry with accepted and expired quotation history", destination: "Dubai family holiday", stage: "QUOTED", createdAt: new Date(0) } });
    leadIds.push(lead.id);
    // Same customer name and enquiry title must not affect identity-based history/navigation.
    const sibling = await db.salesLead.create({ data: { ...common, customerId: sameNameId, id: `${prefix}-sibling`, title: lead.title } });
    leadIds.push(sibling.id);
    // Exact enquiry is deliberately outside the first Sales page, but visible in its customer's history.
    for (let i = 0; i < 51; i++) {
      const other = await db.salesLead.create({ data: { ...common, customerId: sameNameId, id: `${prefix}-other-${i}`, title: `Other customer's enquiry ${i}` } });
      leadIds.push(other.id);
    }
    for (const [version, state] of [[1, "SUPERSEDED"], [2, "ACCEPTED"], [3, "PUBLISHED"]]) {
      await db.salesQuote.create({ data: { leadId: lead.id, version, state, items: "[]", terms: "Synthetic only; no reservation", totalMinor: 10000, costMinor: 8000, expiresAt: new Date(Date.now() - 86400000), acceptedAt: state === "ACCEPTED" ? new Date(Date.now() - 172800000) : null, createdBy: owner.id } });
    }
    const customerUrl = `${base}/customers/${customerId}`;
    await page.goto(customerUrl, { waitUntil: "networkidle" });
    const history = page.getByRole("region", { name: "Enquiries and quotations", exact: true });
    await history.getByText(/Showing 1 of 1 accessible enquiries/).waitFor();
    await history.getByText(/v3 · Expired/).waitFor();
    await history.getByText(/v2 · Accepted/).waitFor();
    await history.getByText(/No CRM booking created/).waitFor();
    assert.equal(await history.locator(`a[href="/sales?lead=${sibling.id}"]`).count(), 0);
    const exact = history.locator(`a[href="/sales?lead=${lead.id}"]`);
    const exactRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/sales" && new URL(response.url()).searchParams.get("leadId") === lead.id && response.request().method() === "GET");
    await exact.click();
    await page.waitForURL(`**/sales?lead=${lead.id}`);
    await page.getByRole("heading", { name: lead.title, exact: true }).waitFor();
    // Assert the actual exact-record API result, not merely an identical title.
    const selected = await exactRead;
    assert(selected.ok());
    const selectedBody = await selected.json();
    assert.equal(selectedBody.lead.id, lead.id);
    assert.equal(selectedBody.lead.customerId, customerId);
    assert.equal(await page.locator(`a[href="/customers/${customerId}"]`).count() > 0, true);
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, `/customers/${customerId}`);
    await exact.waitFor({ state: "visible" });

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(()=>scrollTo(0,0));
      const identity=page.getByRole("heading",{name:"Synthetic same-name customer",exact:true});
      const links=page.locator('[aria-label="Customer record links"]');
      const audit=links.getByRole("link",{name:"Customer record audit history",exact:true});
      const statement=links.getByRole("link",{name:"Customer statement",exact:true});
      assert.equal(await audit.count(),1);
      assert.equal(await statement.getAttribute("href"),`/reports?report=statement&customerId=${encodeURIComponent(customerId)}`);
      const identityBox=await identity.boundingBox(), linkBox=await links.boundingBox();
      assert(identityBox && linkBox && identityBox.y < linkBox.y,"Identity must precede secondary links");
      assert(identityBox.y+identityBox.height<844,"Customer identity visible in first viewport");
      await page.getByRole("link",{name:"All customers",exact:true}).focus();
      assert.equal(await page.getByRole("link",{name:"All customers",exact:true}).evaluate(el=>el===document.activeElement),true);
      await audit.focus();await page.keyboard.press("Tab");
      assert.equal(await statement.evaluate(el=>el===document.activeElement),true,"Secondary links retain keyboard order");
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(shots,`identity-first-${width}.png`),fullPage:false});
      await history.scrollIntoViewIfNeeded();
      const metrics = await history.evaluate(section => {
        const box = section.getBoundingClientRect();
        const texts = [...section.querySelectorAll("h2, p, li, a")].filter(el => el.textContent.trim());
        const minTextPx = Math.min(...texts.map(el => parseFloat(getComputedStyle(el).fontSize)));
        const overflow = [section, ...section.querySelectorAll("*")].filter(el => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0).map(el => el.tagName);
        return { left: box.left, right: box.right, viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, minTextPx, overflow };
      });
      // Retain the actual image even when a geometry/readability assertion fails.
      await history.screenshot({ path: path.join(shots, `history-${width}.png`) });
      assert(metrics.left >= 0 && metrics.right <= width + 1, JSON.stringify(metrics));
      assert(metrics.pageWidth <= width + 1, `Page overflows at ${width}: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.overflow.length, 0, `Nested overflow at ${width}: ${JSON.stringify(metrics)}`);
      assert(metrics.minTextPx >= 13, `History text below reading floor: ${JSON.stringify(metrics)}`);
    }
    await page.goto(`${base}/customers/${emptyId}`, { waitUntil: "networkidle" });
    await history.getByText(/No enquiries visible for this customer in your current scope/).waitFor();
    assert.equal(await history.getByText(/not available with your current access/).count(), 0);
    await history.screenshot({ path: path.join(shots, "empty-320.png") });

    // A permitted customer reader without finance/audit access must still see identity,
    // but neither newly positioned secondary link.
    const visaRole=await db.role.findUniqueOrThrow({where:{key:"VISA_EXECUTIVE"}});
    await db.user.update({where:{id:owner.id},data:{roleId:visaRole.id}});
    await page.goto(customerUrl,{waitUntil:"networkidle"});
    await page.getByRole("heading",{name:"Synthetic same-name customer",exact:true}).waitFor();
    assert.equal(await page.getByRole("link",{name:"Customer record audit history",exact:true}).count(),0);
    assert.equal(await page.getByRole("link",{name:"Customer statement",exact:true}).count(),0);
    assert.equal(await page.locator('[aria-label="Customer record links"]').count(),0,"No empty secondary action band for reader");
    await page.screenshot({path:path.join(shots,"identity-reader-no-finance-320.png"),fullPage:false});
    await db.user.update({where:{id:owner.id},data:{roleId:owner.roleId}});

    // The existing fail-closed unknown-role fallback grants no permissions. This changes only
    // the disposable review user's fixture role, and restores it even when the assertion fails.
    deniedRole = await db.role.create({ data: { key: `${prefix}-DENIED`, name: "Synthetic no-access role", desc: "Browser fixture only" } });
    await db.user.update({ where: { id: owner.id }, data: { roleId: deniedRole.id } });
    await page.goto(customerUrl, { waitUntil: "networkidle" });
    await page.getByText("You do not have permission to view customers.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("link",{name:"Customer record audit history",exact:true}).count(),0);
    assert.equal(await page.getByRole("link",{name:"Customer statement",exact:true}).count(),0);
    assert.equal(await history.count(), 0, "Denied page must not masquerade as an empty sales history");
    assert.equal(await page.getByText(/No enquiries visible for this customer/).count(), 0);
    await page.screenshot({ path: path.join(shots, "denied-320.png"), fullPage: true });
    console.log("Customer sales browser: accepted/expired history, same-name identity, off-page exact enquiry + Back, empty versus denied, 390/320 readability and overflow screenshots.");
  } catch (error) {
    await page.screenshot({ path: path.join(shots, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (owner) await db.user.update({ where: { id: owner.id }, data: { roleId: owner.roleId } });
    if (deniedRole) await db.role.delete({ where: { id: deniedRole.id } });
    await db.salesQuote.deleteMany({ where: { leadId: { in: leadIds } } });
    await db.salesLead.deleteMany({ where: { id: { in: leadIds } } });
    await db.customer.deleteMany({ where: { id: { in: customerIds } } });
    await db.$disconnect();
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
