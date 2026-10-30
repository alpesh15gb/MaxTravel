import { requirePage } from "@/lib/guard";
import ReportCentreClient from "./ReportCentreClient";
import { reportLocationFilters } from "@/lib/report-workspace";
export const dynamic="force-dynamic";
export default async function ReportsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const user=await requirePage("payment:view");const query=reportLocationFilters(await searchParams);return <ReportCentreClient canExport={user.permissions.includes("export:data")} canSupplier={user.accessMode==="ALL"&&user.permissions.includes("supplier:view")} canRefund={user.permissions.includes("refund:view")} canTerms={user.permissions.includes("invoice:create")} initialReport={query.report} initialCustomer={query.customerId} initialFilters={query}/>;}
