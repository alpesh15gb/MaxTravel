import type { SessionUser } from "./session";

export async function audit(
  user: SessionUser | null,
  action: string,
  entity: string,
  entityId?: string,
  detail?: string,
) {
  const { prisma } = await import("./db");
  await prisma.auditLog.create({
    data: { userId: user?.id ?? null, action, entity, entityId: entityId ?? null, detail: detail ?? null },
  });
}
