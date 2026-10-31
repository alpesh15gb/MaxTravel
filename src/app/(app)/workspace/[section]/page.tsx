import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/guard";
import { dayChipLabel } from "@/lib/dates";
import { findSection } from "@/lib/workspace-sections";
import { sectionPermissions } from "@/lib/workspace-overview";
import WorkspaceDashboard from "@/components/WorkspaceDashboard";

export const dynamic = "force-dynamic";
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const section = findSection((await params).section);
  if (!section) notFound();
  await requirePage(sectionPermissions(section.id));
  if (!section.href.startsWith("/workspace/")) redirect(section.href);
  return <WorkspaceDashboard sectionId={section.id} todayLabel={dayChipLabel(new Date())}/>;
}
