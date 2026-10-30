import {redirect} from "next/navigation";
import {caseEntryContext} from "@/lib/service-cases";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import NewVisaCase from "./NewVisaCase";

export const dynamic = "force-dynamic";

export default async function NewVisaCasePage({ searchParams }: { searchParams: Promise<{ case?:string; customer?: string }> }) {
  const user = await requirePage("visa:create");
  const input=await searchParams;const journey=await caseEntryContext(prisma,user,input.case);const customer=journey?.customerId??input.customer;

  if(journey&&(journey.closedAt||journey.service!=="VISA"))redirect(`/cases/${journey.id}`);
  const where: Record<string, unknown> = {};
  if (user.accessMode === "BRANCH") where.branchId = user.branchId;
  if (user.accessMode === "ASSIGNED") where.OR = [{ assignedToId: user.id }, { id: user.id }];

  const [customers, checklists] = await Promise.all([
    prisma.customer.findMany({
      where:journey?{OR:[where,{id:journey.customerId}]}:where,
      select: { id: true, name: true, code: true, travellers: { select: { id: true, fullName: true, relation: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.checklist.findMany({
      where: { active: true },
      select: { id: true, country: true, visaType: true, applicantType: true, version: true },
      orderBy: [{ country: "asc" }, { visaType: "asc" }],
    }),
  ]);

  return (
    <NewVisaCase serviceCase={journey?{id:journey.id,caseNo:journey.caseNo}:null}
      customers={customers}
      checklists={checklists}
      defaultCustomerId={customer ?? null}
      canCreate={user.permissions.includes("visa:create")}
    />
  );
}
