import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import ChecklistsClient from "./ChecklistsClient";

export const dynamic = "force-dynamic";

export default async function ChecklistsPage() {
  const user = await requirePage("checklist:view");
  const checklists = await prisma.checklist.findMany({
    orderBy: [{ country: "asc" }, { visaType: "asc" }, { applicantType: "asc" }, { version: "desc" }],
    include: { items: { orderBy: { sortOrder: "asc" } }, _count: { select: { links: true } } },
  });

  return (
    <ChecklistsClient
      checklists={checklists.map((c) => ({
        id: c.id, country: c.country, visaType: c.visaType, applicantType: c.applicantType,
        version: c.version, active: c.active, notes: c.notes, inUse: c._count.links,
        items: c.items.map((i) => ({
          name: i.name, required: i.required, instructions: i.instructions,
          fileTypes: i.fileTypes, maxSizeMb: i.maxSizeMb, needsExpiry: i.needsExpiry,
          needsVerification: i.needsVerification, travellerType: i.travellerType, sortOrder: i.sortOrder,
        })),
      }))}
      canEdit={can(user.permissions, "checklist:edit")}
    />
  );
}
