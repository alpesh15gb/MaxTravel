import { prisma } from "@/lib/db";
import { requireSession, jsonError } from "@/lib/guard";
import { auditFilters, auditWhere } from "@/lib/audit-query";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await requireSession("audit:view"), params = new URL(req.url).searchParams;
    const where = await auditWhere(prisma,user,auditFilters(params));
    const total = await prisma.auditLog.count({where}), pageSize = 100;
    const requested = Number(params.get("page") || 1);
    const page = Math.min(Math.max(1,Math.ceil(total/pageSize)),Number.isFinite(requested) ? Math.max(1,Math.floor(requested)) : 1);
    const logs = await prisma.auditLog.findMany({where,orderBy:[{at:"desc"},{id:"desc"}],skip:(page-1)*pageSize,take:pageSize,include:{user:{select:{name:true,employeeCode:true}}}});
    return Response.json({logs,total,page,pageSize},{headers:{"Cache-Control":"private, no-store"}});
  } catch(e) { return jsonError(e); }
}
