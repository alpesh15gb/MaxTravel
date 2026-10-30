import {roleCanOwnCase} from "@/lib/service-cases";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import SettingsClient from "./SettingsClient";
import {readCaseConfig} from "@/lib/case-config";
import { readInvoiceConfig } from "@/lib/invoice-config";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePage("settings:manage");
  const [settings, stages] = await Promise.all([
    prisma.settings.findMany(),
    prisma.visaStage.findMany({ orderBy: { seq: "asc" } }),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const owners=await prisma.user.findMany({where:{active:true,...(user.accessMode==="ALL"?{}:{branchId:user.branchId})},select:{id:true,name:true,role:{select:{key:true}}},orderBy:{name:"asc"}});
  return (
    <SettingsClient
      settings={map}
      caseConfig={readCaseConfig(map["case.configuration"])}
      caseOwners={owners.filter(owner=>roleCanOwnCase(owner.role.key)).map(({id,name})=>({id,name}))}
      invoiceConfig={readInvoiceConfig(map["invoice.configuration"])}
      stages={stages.map((s) => ({ id: s.id, key: s.key, name: s.name, seq: s.seq, system: s.system, active: s.active }))}
      canEdit={can(user.permissions, "settings:manage")}
    />
  );
}
