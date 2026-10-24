import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireSession,jsonError,ApiError } from "@/lib/guard";
import { optionalId,nextReference,money,transactionAudit } from "@/lib/transactions";
import { employeeReadScope, employeeRecoveryContext, employeeRevision } from "@/lib/employee-recovery-server";
const noStore = { "Cache-Control": "private, no-store" };
export async function GET(req: Request) {
 try {
  const user = await requireSession("employee:view");
  if (!user.permissions.includes("employee:manage")) throw new ApiError(403, "Employee management permission is required.");
  const recoveryContext = employeeRecoveryContext(user);
  if (req.headers.get("X-Employee-Recovery-Context") !== recoveryContext) return Response.json({ error: "Staff session or access changed. Reload the team page before continuing.", code: "EMPLOYEE_CONTEXT_CHANGED" }, { status: 409, headers: noStore });
  const params = new URL(req.url).searchParams;
  const id = params.get("employeeId"), email = params.get("email");
  if ((params.has("employeeId") === params.has("email")) || (!id && !email) || (id && (id.length > 200 || params.getAll("employeeId").length !== 1)) || (email && (email.length > 320 || params.getAll("email").length !== 1))) throw new ApiError(400, "Choose one employee to check.");
  const employee = await prisma.user.findFirst({ where: { AND: [employeeReadScope(user), id ? { id } : { email: email!.trim().toLowerCase() }] }, include: { role: true, branch: true } });
  const hrVisible = user.permissions.includes("hr:view");
  return Response.json({ recoveryContext, employee: employee ? {
   id: employee.id, employeeCode: employee.employeeCode, name: employee.name, email: employee.email, phone: employee.phone,
   roleId: employee.roleId, role: employee.role.name, branchId: employee.branchId, branch: employee.branch?.name ?? "—", active: employee.active,
   salary: hrVisible ? employee.salary : null, bankAccount: hrVisible ? employee.bankAccount : null, hrVisible, revision: employeeRevision(employee),
  } : null }, { headers: noStore });
 } catch (error) { const response = jsonError(error); response.headers.set("Cache-Control", noStore["Cache-Control"]); return response; }
}
export async function POST(req:Request){let checkedContext:string|undefined;try{const user=await requireSession("employee:manage");const context=employeeRecoveryContext(user);checkedContext=context;const expected=req.headers.get("X-Employee-Recovery-Context");if(expected!==null&&expected!==context)return Response.json({error:"Staff session or access changed. Reload the team page before continuing.",code:"EMPLOYEE_CONTEXT_CHANGED",employeeWrite:"rejected"},{status:409,headers:noStore});const b=await req.json();const admin=["OWNER","SUPER_ADMIN"].includes(user.role);const password=optionalId(b.password);if(password&&(Buffer.byteLength(password)>72||password.length<12||!/[a-zA-Z]/.test(password)||! /[^a-zA-Z]/.test(password)))throw new ApiError(400,"Use 12 or more password characters with a letter and a number or symbol; maximum 72 bytes.");const passwordHash=password?await bcrypt.hash(password,12):undefined;
 const employee=await prisma.$transaction(async tx=>{
 const existing=b.id?await tx.user.findUnique({where:{id:String(b.id)},include:{role:true}}):null;if(b.id&&!existing)throw new ApiError(404,"Employee not found.");if(expected!==null&&existing&&(typeof b.baseRevision!=="string"||b.baseRevision!==employeeRevision(existing)))throw new ApiError(409,"This employee changed since you opened it. Check the current record before saving again.");if(existing&&["OWNER","SUPER_ADMIN"].includes(existing.role.key)&&!admin)throw new ApiError(403,"Only an owner or super administrator may manage administrator accounts.");
  // Setting a password on an existing account is a takeover, whatever role the caller manages: HR
  // reaches HR and read-only peers, and resetting a colleague's password hands over the whole
  // account — including that colleague's own salary and bank details. Onboarding a new person is
  // different (the agency chose that password to hand over), so creating is still allowed here.
  if(password&&existing&&!admin)throw new ApiError(403,"Only an owner or super administrator can reset a colleague's password. Ask them to set it, or use your own change-password screen for your own account.");
 const roleId=optionalId(b.roleId)??existing?.roleId;if(!roleId)throw new ApiError(400,"Choose a role.");const role=await tx.role.findUnique({where:{id:roleId}});if(!role)throw new ApiError(400,"Role not found.");if(!admin&&! ["HR","READ_ONLY"].includes(role.key))throw new ApiError(403,"HR may manage HR and read-only roles. Ask the agency owner to assign operational or administrator access.");
 const name=b.name===undefined?existing?.name:optionalId(b.name),email=b.email===undefined?existing?.email:optionalId(b.email)?.toLowerCase();if(!name||name.length>150||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,"Enter a name and valid work email.");const dup=await tx.user.findUnique({where:{email}});if(dup&&dup.id!==existing?.id)throw new ApiError(400,"Email is already in use.");
 const branchId=b.branchId===undefined?existing?.branchId??user.branchId:optionalId(b.branchId);if(branchId&&!(await tx.branch.findUnique({where:{id:branchId}})))throw new ApiError(400,"Branch not found.");const active=b.active===undefined?existing?.active??true:b.active;if(typeof active!=="boolean")throw new ApiError(400,"Active status must be true or false.");
 if(existing?.id===user.id&&(!active||role.key!==user.role))throw new ApiError(400,"You cannot deactivate yourself or change your own role.");
 if(existing?.active&&["OWNER","SUPER_ADMIN"].includes(existing.role.key)&&(!active||!["OWNER","SUPER_ADMIN"].includes(role.key))&&await tx.user.count({where:{active:true,id:{not:existing.id},role:{key:{in:["OWNER","SUPER_ADMIN"]}}}})===0)throw new ApiError(400,"Keep at least one active owner or super administrator.");
 const data={name,email,phone:b.phone===undefined?existing?.phone??"":String(b.phone),roleId,branchId,active,...(passwordHash?{passwordHash}:{}),...(user.permissions.includes("hr:view")?{salary:b.salary===undefined?existing?.salary:b.salary===null||b.salary===""?null:money(b.salary,"Salary"),bankAccount:b.bankAccount===undefined?existing?.bankAccount:optionalId(b.bankAccount)}:{})};
 if(!existing&&!passwordHash)throw new ApiError(400,"An initial password is required.");
 const e=existing?await tx.user.update({where:{id:existing.id},data}):await tx.user.create({data:{...data,passwordHash:passwordHash!,employeeCode:await nextReference(tx, "EMP"),joinedOn:new Date()}});
 await transactionAudit(tx,user,existing?"EDIT":"CREATE","User",e.id,e.employeeCode);return e;
 });return Response.json({ok:true,employeeId:employee.id,employeeCode:employee.employeeCode,recoveryContext:context},{headers:noStore});}catch(e){if(e instanceof ApiError)return Response.json({error:e.message,employeeWrite:"rejected",...(checkedContext?{recoveryContext:checkedContext}:{})},{status:e.status,headers:noStore});const response=jsonError(e);response.headers.set("Cache-Control",noStore["Cache-Control"]);return response;}}
