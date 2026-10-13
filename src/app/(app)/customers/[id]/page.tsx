import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { loadCustomer360 } from "@/lib/customer360";
import { can } from "@/lib/rbac";
import Customer360View from "./Customer360View";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Customer360Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getServerSession();
  if (!user) redirect("/login");
  if (!can(user.permissions, "customer:view")) {
    return <div className="p-10 text-sm text-rose-700">You do not have permission to view customers.</div>;
  }
  const { id } = await params;
  const { tab } = await searchParams;
  const data = await loadCustomer360(id, user);
  if (!data) notFound();

  return (
    <>
    {can(user.permissions,"payment:view")&&<div className="mb-4 flex justify-end"><a className="btn-secondary" href={`/reports?report=statement&customerId=${encodeURIComponent(id)}`}>Customer statement</a></div>}
    <Customer360View
      data={data}
      owners={["OWNER", "SUPER_ADMIN", "BRANCH_MANAGER"].includes(user.role) ? await prisma.user.findMany({where:{active:true,branchId:(await prisma.customer.findUniqueOrThrow({where:{id}})).branchId},select:{id:true,name:true},orderBy:{name:"asc"}}) : []}
      perms={{
        sensitive: can(user.permissions, "sensitive:view"),
        invoice: can(user.permissions, "invoice:create"),
        editCustomer: can(user.permissions, "customer:edit"),
        finance: can(user.permissions, "payment:view"),
        visibleTabs: ["overview", "notes", ...(can(user.permissions, "traveller:view") ? ["travellers"] : []), ...(can(user.permissions, "visa:view") ? ["visa"] : []), ...(can(user.permissions, "ticketing:view") ? ["tickets", "trips"] : []), ...(can(user.permissions, "document:view") ? ["documents"] : []), ...(can(user.permissions, "payment:view") ? ["payments"] : []), ...(can(user.permissions, "refund:view") ? ["refunds"] : []), ...(can(user.permissions, "whatsapp:view") ? ["whatsapp"] : []), ...(can(user.permissions, "task:view") ? ["tasks"] : []), ...(can(user.permissions, "payment:view") && can(user.permissions, "sensitive:view") ? ["activity"] : [])],
        send: can(user.permissions, "whatsapp:send"),
        record: can(user.permissions, "payment:record"),
        createVisa: can(user.permissions, "visa:create"),
        createTicket: can(user.permissions, "ticketing:create"),
        createTask: can(user.permissions, "task:create"),
        requestDocs: can(user.permissions, "customer:edit") || can(user.permissions, "document:upload"),
      }}
      initialTab={tab}
      permsExtra={{
        addTraveller: can(user.permissions, "traveller:create"),
        editTraveller: can(user.permissions, "traveller:edit"),
        export: can(user.permissions, "export:data"),
      }}
    />
    </>
  );
}
