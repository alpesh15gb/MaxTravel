import { requirePage } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { computePulse } from "@/lib/pulse";
import { PageHeader } from "@/components/ui";
import { AttentionList } from "@/components/WorkspaceDashboard";
import WorkRefresh from "@/components/WorkRefresh";
export const dynamic = "force-dynamic";
export default async function ServiceAlerts() {
  const user = await requirePage("dashboard:view"),
    pulse = await computePulse(prisma, user),
    items = pulse.items.filter((i) => !i.kind.startsWith("TASK_"));
  return (
    <div className="workspace-page work-desk">
      <PageHeader
        title="Service alerts"
        description="Review due sales follow-ups, accepted quotes, supplier holds, appointments and other service exceptions."
        actions={<WorkRefresh />}
      />
      <section className="panel section-attention" aria-label="Attention queue">
        <div className="section-block-heading">
          <div>
            <h2>Needs your attention</h2>
            <p>
              Open an alert to review the service and its next action.
            </p>
          </div>
        </div>
        <AttentionList
          items={items}
          empty="No service alerts in this view"
          description="Refresh as work progresses. Source records determine which alerts remain."
        />
      </section>
    </div>
  );
}
