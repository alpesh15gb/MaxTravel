import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { initializeReferenceData } from "@/lib/bootstrap";
import { ApiError, jsonError } from "@/lib/guard";
import { isLockedOut, recordFailure } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    // Cross-origin mutations are rejected centrally by middleware, including first-run setup.
    if (await prisma.user.count()) throw new ApiError(409, "This agency is already configured. Sign in with your own account.");
    const key = "agency-setup";
    if (isLockedOut(key)) throw new ApiError(429, "Too many setup attempts. Please try again in a few minutes.");
    const b = await req.json();
    const agencyName = String(b.agencyName ?? "").trim();
    const name = String(b.name ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const city = String(b.city ?? "").trim();
    const password = String(b.password ?? "");
    if (agencyName.length < 2 || name.length < 2 || !city || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      recordFailure(key);
      throw new ApiError(400, "Enter your agency name, city, full name and a valid email address.");
    }
    if (agencyName.length > 120 || name.length > 120 || city.length > 120 || email.length > 254 || Buffer.byteLength(password) > 72) throw new ApiError(400, "One or more fields are too long.");
    if (password.length < 12 || !/[a-zA-Z]/.test(password) || !/[^a-zA-Z]/.test(password)) {
      throw new ApiError(400, "Use at least 12 characters, including a letter and a number or symbol.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      if (await tx.user.count()) throw new ApiError(409, "This agency has already been configured.");
      // The unique key also protects concurrent initialization attempts.
      await tx.settings.create({ data: { key: "agency.initialized", value: "true" } });
      await initializeReferenceData(tx);
      const role = await tx.role.findUniqueOrThrow({ where: { key: "OWNER" } });
      const branch = await tx.branch.create({ data: { name: "Head office", code: "HQ", city } });
      await tx.user.create({ data: { employeeCode: "EMP-001", name, email, phone: String(b.phone ?? "").trim(), passwordHash, roleId: role.id, branchId: branch.id, joinedOn: new Date() } });
      for (const [settingKey, value] of [["agency.name", agencyName], ["agency.city", city], ["pnr.warning.hours", "24"], ["pnr.urgent.hours", "8"], ["passport.min.validity.months", "6"]]) {
        await tx.settings.upsert({ where: { key: settingKey }, update: { value }, create: { key: settingKey, value } });
      }
    }, { maxWait: 10000, timeout: 20000 });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(e.code)) return Response.json({ error: "Setup was completed by another request. Please sign in." }, { status: 409 });
    return jsonError(e);
  }
}
