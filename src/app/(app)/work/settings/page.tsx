import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { readWorkConfig } from "@/lib/work-config";
import { ROLE_PERMISSIONS, type RoleKey } from "@/lib/permissions";
import WorkSettings from "@/components/WorkSettings";
export const dynamic = "force-dynamic";
export default async function WorkSettingsPage() {
  await requirePage("settings:manage");
  const [setting, people] = await Promise.all([
    prisma.settings.findUnique({ where: { key: "work.configuration" } }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: { select: { key: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <WorkSettings
      initial={readWorkConfig(setting?.value)}
      people={people.map((p) => {
        const permissions = ROLE_PERMISSIONS[p.role.key as RoleKey] ?? [];
        return {
          id: p.id,
          name: p.name,
          services: ["VISA", "FLIGHT", "HOTEL"].filter((s) =>
            permissions.includes(s === "VISA" ? "visa:view" : "ticketing:view"),
          ),
          canWork: permissions.includes("task:edit"),
          canReview: permissions.includes("work:review"),
          canEscalate: permissions.includes("work:assign"),
          canFinance: permissions.includes("payment:view"),
        };
      })}
    />
  );
}
