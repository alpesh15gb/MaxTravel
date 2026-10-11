// Persistent preview server for the implementation build. Isolated runtime DB; live data untouched.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import net from "node:net";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const runtime = path.join(ROOT, "tests", ".runtime", `demo-${Date.now()}`);
mkdirSync(runtime, { recursive: true });
const database = `file:${path.join(runtime, "test.db").replaceAll("\\", "/")}`;
const PORT = 3212;
await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(PORT, "127.0.0.1", () => s.close(resolve)); });
const BASE = `http://localhost:${PORT}`;
const password = `Demo-${randomBytes(12).toString("hex")}!`;
const env = { ...process.env, DATABASE_URL: database, JWT_SECRET: randomBytes(32).toString("hex"), UPLOAD_ROOT: path.join(runtime, "uploads"), NEXT_DIST_DIR: ".next-implementation" };
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: ROOT, env, stdio: "pipe" });
const log = createWriteStream(path.join(runtime, "server.log"));
const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT), "--hostname", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { const r = await fetch(`${BASE.replace("localhost", "127.0.0.1")}/setup`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
const post = (url, body, cookie = "") => fetch(`${BASE.replace("localhost", "127.0.0.1")}${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function ok(url, body, cookie) { const r = await post(url, body, cookie); const d = await r.json(); if (!r.ok) throw new Error(`${url}: ${JSON.stringify(d)}`); return d; }
await ok("/api/setup", { agencyName: "Skyline Travels (Demo)", city: "Pune", name: "Demo Owner", email: "owner@demo.test", phone: "+919000000001", password }, "", BASE);
const login = await post("/api/auth/login", { email: "owner@demo.test", password });
const owner = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const alice = await ok("/api/customers", { name: "Meera Sharma", phone: "+919812345678", email: "meera@example.test", city: "Pune" }, owner);
const bob = await ok("/api/customers", { name: "Arjun Mehta", phone: "+919823456789", city: "Mumbai" }, owner);
const aliceTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: alice.id } });
const checklist = await ok("/api/checklists", { country: "Schengen (Germany)", visaType: "Tourist", applicantType: "STANDARD", items: [{ name: "Passport", required: true, fileTypes: "pdf,jpg", maxSizeMb: 5, needsVerification: true }, { name: "Bank statement", required: true, fileTypes: "pdf", maxSizeMb: 10, needsVerification: true }] }, owner);
await ok("/api/visa/cases", { customerId: alice.id, travellerIds: [aliceTraveller.id], destination: "Schengen (Germany)", visaType: "Tourist", checklistId: checklist.checklist.id, visaFee: 7500, serviceFee: 2500, travelDate: "2026-12-15" }, owner);
const booking = await ok("/api/bookings", { customerId: alice.id, travellerIds: [aliceTraveller.id], pnr: "SKY7QX", sector: "BOM → FRA", airline: "Lufthansa", deadlineHours: 20, fare: 32000, taxes: 4500, markup: 2000, serviceFee: 1500 }, owner);
const bobTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: bob.id } });
const enquiry = await ok("/api/bookings", { customerId: bob.id, travellerIds: [bobTraveller.id], sector: "BOM → DXB", fare: 18500, taxes: 2800 }, owner);
await ok("/api/payments", { customerId: alice.id, bookingId: booking.bookingId, amount: 20000, mode: "UPI", note: "Advance towards Europe trip" }, owner);
await ok("/api/tasks", { title: "Call Meera about travel insurance", priority: "HIGH", customerId: alice.id, details: "She asked about Schengen insurance cover on WhatsApp." }, owner);
writeFileSync(path.join(ROOT, "tests", ".runtime", "demo-current.json"), JSON.stringify({ runtime, base: BASE, serverPid: server.pid, ownerEmail: "owner@demo.test", password }, null, 2));
console.log(`DEMO READY ${BASE} pid=${server.pid}`);
console.log(`Login: owner@demo.test / ${password}`);
server.on("exit", code => { console.log(`Server exited ${code}`); log.end(); process.exitCode = code ?? 1; });
