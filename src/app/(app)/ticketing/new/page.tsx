import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {isClosedCase} from "@/lib/case-constants";
import {redirect} from "next/navigation";
import {caseEntryContext} from "@/lib/service-cases";
import { prisma } from "@/lib/db";
import { canTouchRecord,requirePage } from "@/lib/guard";
import NewBooking from "./NewBooking";

export const dynamic = "force-dynamic";

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ case?:string; customer?: string; product?: string }> }) {
  const user = await requirePage("ticketing:create");
  const input=await searchParams;const journey=await caseEntryContext(prisma,user,input.case);const customer=journey?.customerId??input.customer,product=input.product??(journey?.service==="VISA"?"FLIGHT":journey?.service);

  if(journey&&isClosedCase(journey))redirect(`/trips/${journey.id}`);
  const where: Record<string, unknown> = {};
  if (user.accessMode === "BRANCH") where.branchId = user.branchId;
  if (user.accessMode === "ASSIGNED") where.OR = [{ assignedToId: user.id }, { id: user.id }];

  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where:journey?{OR:[where,{id:journey.customerId}]}:where,
      select: { id: true, name: true, code: true,branchId:true,assignedToId:true,travellers: { select: { id: true, fullName: true, relation: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return <NewBooking recoveryContext={salesRecoveryContext(user)} serviceCase={journey?{id:journey.id,caseNo:journey.caseNo}:null} customers={customers.map(({branchId,assignedToId,...c})=>({...c,canOpenMaster:user.permissions.includes("customer:view")&&canTouchRecord(user,{id:c.id,branchId,assignedToId})}))} suppliers={suppliers} defaultCustomerId={customer ?? null} defaultProduct={["FLIGHT","HOTEL","STAY","BUS","TRAIN","INSURANCE"].includes(product??"")?product!:"FLIGHT"} />;
}
