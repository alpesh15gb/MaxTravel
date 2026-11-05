import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import { verifyStaffMfa } from "./staff-mfa";
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
  sessionId?: string;
  mfaEnabled?: boolean;
  workRecordIds?: string[];
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

export async function setSessionCookie(u: SessionUser, secure = false, agent = "Unknown browser") {
  const { prisma } = await import("./db");
  const sessionId = randomUUID();
  await prisma.staffSession.create({data:{id:sessionId,userId:u.id,expiresAt:new Date(Date.now()+12*60*60*1000),agent:agent.slice(0,200)}});
  u = {...u, sessionId};
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
  const token = (await cookies()).get(COOKIE)?.value;
  let sessionId:string|undefined;
  if(token) { try { const {payload}=await jwtVerify(token,SECRET); if(typeof payload.sessionId==="string")sessionId=payload.sessionId; } catch { /* Invalid cookies cannot identify a session. */ } }
  if(sessionId){const {prisma}=await import("./db");await prisma.staffSession.updateMany({where:{id:sessionId},data:{revokedAt:new Date()}});}
  (await cookies()).delete(COOKIE);
}

export async function getServerSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.id !== "string" || typeof payload.sessionId !== "string") return null;
    const { prisma } = await import("./db");
    const session = await prisma.staffSession.findUnique({where:{id:payload.sessionId}});
    if(!session || session.userId!==payload.id || session.revokedAt || session.expiresAt.getTime()<=Date.now())return null;
    const user = await prisma.user.findUnique({ where: { id: payload.id }, include: { role: true, branch: true } });
    if (!user?.active || payload.authVersion !== credentialVersion(user.passwordHash)) return null;
    const role = user.role.key as RoleKey;
    const mfa = await prisma.staffMfa.findUnique({where:{userId:user.id},select:{enabled:true}});
    const delegated = ROLE_ACCESS[role]==='ASSIGNED' ? await prisma.task.findMany({where:{unassigned:false,OR:[{ownerId:user.id},{reviewerId:user.id}]},select:{bookingId:true,visaCaseId:true,serviceCaseId:true,serviceWork:{select:{service:true}}}}) : [];
    const quoteCases=delegated.filter(t=>t.serviceCaseId&&["FLIGHT","HOTEL"].includes(t.serviceWork?.service??""));
    const quotes=ROLE_ACCESS[role]==="ASSIGNED"&&ROLE_PERMISSIONS[role].includes("ticketing:view")?await prisma.salesLead.findMany({where:{OR:[{serviceCase:{ownerId:user.id}},...quoteCases.map(t=>({serviceCaseId:t.serviceCaseId,product:t.serviceWork!.service}))]},select:{id:true}}):[];
    // A service assignment grants its work records, not the customer's entire master or other services.
    const bookingAssignments=delegated.filter(t=>t.serviceCaseId&&["FLIGHT","HOTEL","STAY","BUS","TRAIN","INSURANCE"].includes(t.serviceWork?.service??""));
    const visaAssignments=delegated.filter(t=>t.serviceCaseId&&t.serviceWork?.service==="VISA");
    const [assignedBookings,assignedVisas]=await Promise.all([
      ROLE_PERMISSIONS[role]?.includes("ticketing:view")&&bookingAssignments.length?prisma.booking.findMany({where:{OR:bookingAssignments.map(t=>({serviceCaseId:t.serviceCaseId,product:t.serviceWork!.service}))},select:{id:true}}):[],
      ROLE_PERMISSIONS[role]?.includes("visa:view")&&visaAssignments.length?prisma.visaCase.findMany({where:{serviceCaseId:{in:visaAssignments.map(t=>t.serviceCaseId!)}},select:{id:true}}):[],
    ]);
    const viewCustomerIds = role==="READ_ONLY"?(await prisma.customer.findMany({where:{assignedToId:user.id},select:{id:true}})).map(customer=>customer.id):[];
    const [viewBookings,viewVisas,viewQuotes] = await Promise.all([
      viewCustomerIds.length&&ROLE_PERMISSIONS[role].includes("ticketing:view")?prisma.booking.findMany({where:{customerId:{in:viewCustomerIds}},select:{id:true}}):[],
      viewCustomerIds.length&&ROLE_PERMISSIONS[role].includes("visa:view")?prisma.visaCase.findMany({where:{customerId:{in:viewCustomerIds}},select:{id:true}}):[],
      viewCustomerIds.length&&ROLE_PERMISSIONS[role].includes("customer:view")?prisma.salesLead.findMany({where:{customerId:{in:viewCustomerIds}},select:{id:true}}):[],
    ]);
    const workRecordIds = [...new Set([...delegated.flatMap(t=>[t.bookingId,t.visaCaseId].filter((id):id is string=>!!id)),...quotes.map(q=>q.id),...assignedBookings.map(b=>b.id),...assignedVisas.map(v=>v.id),...viewBookings.map(row=>row.id),...viewVisas.map(row=>row.id),...viewQuotes.map(row=>row.id)])];
    return { workRecordIds, mfaEnabled:!!mfa?.enabled, sessionId: session.id, id: user.id, name: user.name, email: user.email, role, roleName: user.role.name,
      branchId: user.branchId, branchName: user.branch?.name ?? null, employeeCode: user.employeeCode,
      accessMode: ROLE_ACCESS[role] ?? "ASSIGNED", permissions: ROLE_PERMISSIONS[role] ?? [] };
  } catch {
    return null;
  }
}

export async function login(email: string, password: string, req?: Request, mfaCode = ""): Promise<SessionUser | null> {
  const { prisma } = await import("./db");
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { role: true, branch: true },
  });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok || !(await verifyStaffMfa(user.id,mfaCode))) return null;
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
  await setSessionCookie(su, req ? requestIsSecure(req) : false, req?.headers.get("user-agent")??"Unknown browser");
  return su;
}

export function permissionsFor(role: RoleKey): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
