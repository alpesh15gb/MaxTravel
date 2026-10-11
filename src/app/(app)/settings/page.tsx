import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePage("settings:manage");
  const [settings, stages] = await Promise.all([
    prisma.settings.findMany(),
    prisma.visaStage.findMany({ orderBy: { seq: "asc" } }),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  return (
    <SettingsClient
      settings={map}
      stages={stages.map((s) => ({ id: s.id, key: s.key, name: s.name, seq: s.seq, system: s.system, active: s.active }))}
      canEdit={can(user.permissions, "settings:manage")}
    />
  );
}
