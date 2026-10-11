import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import AuditClient from "./AuditClient";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requirePage("audit:view");
  const { page } = await searchParams;
  const raw = Number(page ?? 1);
  const pageNum = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
  const pageSize = 100;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { at: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, employeeCode: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  return (
    <AuditClient
      logs={logs.map((l) => ({
        id: l.id, action: l.action, entity: l.entity, entityId: l.entityId, detail: l.detail,
        user: l.user ? `${l.user.name} (${l.user.employeeCode})` : "System",
        at: l.at.toISOString(),
      }))}
      total={total}
      page={pageNum}
      pageSize={pageSize}
      canExport={can(user.permissions, "export:data")}
    />
  );
}
