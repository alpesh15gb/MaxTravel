import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { CASE_READ, caseCustomerScope } from "@/lib/service-cases";
import { PageHeader, EmptyState } from "@/components/ui";
import NewTrip, { type NeedId } from "./NewTrip";
export const dynamic = "force-dynamic";

export default async function NewTripPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePage([...CASE_READ]), sp = await searchParams;
  const can = (p: string) => user.permissions.includes(p as (typeof user.permissions)[number]);
  const ticketing = can("ticketing:create");
  const needs: NeedId[] = can("customer:view") ? [...(ticketing && can("customer:create") && can("customer:edit") ? ["ENQUIRY" as const] : []), ...(ticketing ? ["FLIGHT" as const, "HOTEL" as const] : []), ...(can("visa:create") ? ["VISA" as const] : []), ...(ticketing ? ["OTHER" as const] : [])] : [];
  const initial = sp.customer && can("customer:view") ? await prisma.customer.findFirst({ where: { AND: [caseCustomerScope(user), { id: sp.customer, mergedIntoId: null }] }, select: { id: true, name: true, code: true } }) : null;
  return <div className="workspace-page mx-auto max-w-4xl space-y-5">
    <PageHeader title="New trip" description="Every piece of work starts as a trip with its own Max ID. Pick the customer, then what they need." />
    {needs.length ? <NewTrip needs={needs} initial={initial} canAddCustomer={can("customer:create")} />
      : <EmptyState title="Your role cannot start trips" description="Ask an admin to give you booking or visa access." href="/today" action="Back to Today" />}
  </div>;
}
