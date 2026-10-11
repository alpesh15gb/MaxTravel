// Focused repro: supplier part-payment refresh stall.
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { chromium } from "./browser.mjs";
const ROOT = process.cwd();
const runtime = path.join(ROOT, "tests", ".runtime", `repro-${Date.now()}`);
mkdirSync(runtime, { recursive: true });
const database = `file:${path.join(runtime, "test.db").replaceAll("\\", "/")}`;
const PORT = 3214;
await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(PORT, "127.0.0.1", () => s.close(resolve)); });
const BASE = `http://127.0.0.1:${PORT}`;
const password = `Repro-${randomBytes(15).toString("hex")}!`;
const env = { ...process.env, DATABASE_URL: database, JWT_SECRET: randomBytes(32).toString("hex"), UPLOAD_ROOT: path.join(runtime, "uploads"), NEXT_DIST_DIR: ".next-implementation" };
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
const log = createWriteStream(path.join(runtime, "server.log"));
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: ROOT, env, stdio: "pipe" });
const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT), "--hostname", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { const r = await fetch(`${BASE}/setup`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
const post = (url, body, cookie = "") => fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function ok(url, body, cookie) { const r = await post(url, body, cookie); const d = await r.json(); if (!r.ok) throw new Error(`${url}: ${JSON.stringify(d)}`); return d; }
const setup = await post("/api/setup", { agencyName: "Repro Agency", city: "Pune", name: "Repro Owner", email: "owner@repro.test", password }, "", BASE);
if (setup.status !== 201) throw new Error(await setup.text());
const login = await post("/api/auth/login", { email: "owner@repro.test", password });
const owner = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const supplier = await ok("/api/suppliers", { name: "Repro Supplier", type: "CONSOLIDATOR", city: "Mumbai", paymentDueDays: 10 }, owner);
await ok("/api/suppliers/dues", { supplierId: supplier.supplier.id, description: "Consolidator bill", amount: 500, dueDate: "2026-09-01" }, owner);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("console", m => console.log(`[console:${m.type()}]`, m.text().slice(0, 200)));
page.on("pageerror", e => console.log(`[pageerror]`, e.message.slice(0, 300)));
page.on("response", r => { if (r.request().resourceType() === "fetch" || r.request().resourceType() === "xhr") console.log(`[resp]`, r.status(), r.url().slice(BASE.length, BASE.length + 80)); });
page.on("dialog", d => d.accept(d.type() === "prompt" ? "300" : ""));
await page.goto(`${BASE}/login`);
await page.getByLabel("Work email", { exact: true }).fill("owner@repro.test");
await page.getByLabel("Password", { exact: true }).fill(password);
await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
await page.waitForURL("**/dashboard");
// Server-side isolation: pay via node fetch, then fetch fresh page HTML
const duesRow = await prisma.supplierDue.findFirstOrThrow();
const pay1 = await post("/api/suppliers/dues", { dueId: duesRow.id, paid: true, amount: 300 }, owner);
console.log("[api part-pay]", pay1.status, JSON.stringify(await pay1.json()));
const html = await (await fetch(`${BASE}/suppliers`, { headers: { cookie: owner } })).text();
console.log("[server html contains settled ₹300]", html.includes("settled ₹300"));
console.log("[server html contains ₹200 payable]", html.includes("₹200 payable"));
const duesAfter = await prisma.supplierDue.findFirstOrThrow();
console.log("[db]", JSON.stringify(duesAfter));
await prisma.supplierDue.update({ where: { id: duesRow.id }, data: { paidAmount: 0, paid: false, paidOn: null } });

await page.goto(`${BASE}/suppliers`);
await page.getByRole("button", { name: "Record payment" }).click();
console.log("--- clicked; polling DOM every 2s ---");
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2000);
  const text = (await page.locator("main").innerText()).replaceAll("\n", " | ");
  console.log(`[t+${(i + 1) * 2}s]`, text.slice(0, 400));
  if (text.includes("settled")) break;
}
await browser.close();
server.kill();
await prisma.$disconnect();
