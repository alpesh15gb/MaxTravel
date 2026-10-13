import { requirePage } from "@/lib/guard";
import ReportCentreClient from "./ReportCentreClient";
export const dynamic="force-dynamic";
export default async function ReportsPage({searchParams}:{searchParams:Promise<{report?:string;customerId?:string}>}){const user=await requirePage("payment:view");const query=await searchParams;return <ReportCentreClient canExport={user.permissions.includes("export:data")} canSupplier={user.accessMode==="ALL"&&user.permissions.includes("supplier:view")} canRefund={user.permissions.includes("refund:view")} canTerms={user.permissions.includes("invoice:create")} initialReport={query.report} initialCustomer={query.customerId}/>;}
