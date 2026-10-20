import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { auditFilters, auditWhere } from "@/lib/audit-query";
import AuditClient from "./AuditClient";
export const dynamic = "force-dynamic";
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const user = await requirePage("audit:view");
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(await searchParams)) if(typeof value === "string") params.set(key,value);
  let filters; try { filters = auditFilters(params); } catch(e) { return <div className="panel p-6" role="alert">{e instanceof Error ? e.message : "Invalid audit filters."} <a href="/audit">Clear filters</a></div>; }
  const raw = Number(params.get("page") ?? 1), pageSize = 100;
  const where = await auditWhere(prisma,user,filters);
  const total = await prisma.auditLog.count({where});
  const pageNum = Math.min(Math.max(1,Math.ceil(total/pageSize)),Number.isFinite(raw) ? Math.max(1,Math.floor(raw)) : 1);
  const logs = await prisma.auditLog.findMany({where,orderBy:[{at:"desc"},{id:"desc"}],skip:(pageNum-1)*pageSize,take:pageSize,include:{user:{select:{name:true,employeeCode:true}}}});
  return <AuditClient logs={logs.map(l=>({...l,user:l.user ? `${l.user.name} (${l.user.employeeCode})` : "System / external",at:l.at.toISOString()}))} total={total} page={pageNum} pageSize={pageSize} canExport={can(user.permissions,"export:data")} filters={filters} restricted={user.accessMode!=="ALL"}/>;
}
