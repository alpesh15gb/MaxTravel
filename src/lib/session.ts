import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import type { AccessMode, Permission, RoleKey } from "./permissions";
import { ROLE_ACCESS, ROLE_PERMISSIONS } from "./permissions";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
const credentialVersion = (hash: string) => createHash("sha256").update(hash).digest("hex");
const COOKIE = "tos_session";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  roleName: string;
  branchId: string | null;
  branchName: string | null;
  employeeCode: string;
  accessMode: AccessMode;
  permissions: Permission[];
  authVersion?: string;
}

export async function signSession(u: SessionUser): Promise<string> {
  if (SECRET.length < 32) throw new Error("JWT_SECRET must contain at least 32 bytes.");
  return await new SignJWT({ ...u })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(SECRET);
}

/** True only when the request actually arrived over HTTPS (directly or via a proxy). */
export function requestIsSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function setSessionCookie(u: SessionUser, secure = false) {
  const token = await signSession(u);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 60 * 60 * 12,
    path: "/",
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function getServerSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.id !== "string") return null;
    const { prisma } = await import("./db");
    const user = await prisma.user.findUnique({ where: { id: payload.id }, include: { role: true, branch: true } });
    if (!user?.active || payload.authVersion !== credentialVersion(user.passwordHash)) return null;
    const role = user.role.key as RoleKey;
    return { id: user.id, name: user.name, email: user.email, role, roleName: user.role.name,
      branchId: user.branchId, branchName: user.branch?.name ?? null, employeeCode: user.employeeCode,
      accessMode: ROLE_ACCESS[role] ?? "ASSIGNED", permissions: ROLE_PERMISSIONS[role] ?? [] };
  } catch {
    return null;
  }
}

export async function login(email: string, password: string, req?: Request): Promise<SessionUser | null> {
  const { prisma } = await import("./db");
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { role: true, branch: true },
  });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  const role = user.role.key as RoleKey;
  const su: SessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    roleName: user.role.name,
    branchId: user.branchId,
    branchName: user.branch?.name ?? null,
    employeeCode: user.employeeCode,
    accessMode: ROLE_ACCESS[role] ?? "ASSIGNED",
    permissions: ROLE_PERMISSIONS[role] ?? [],
    authVersion: credentialVersion(user.passwordHash),
  };
  await setSessionCookie(su, req ? requestIsSecure(req) : false);
  return su;
}

export function permissionsFor(role: RoleKey): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
