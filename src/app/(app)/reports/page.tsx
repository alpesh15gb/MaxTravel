import {canViewInternalFinance} from "@/lib/finance-policy";
import { requirePage } from "@/lib/guard";
import ReportCentreClient from "./ReportCentreClient";
import ReportCards from "./ReportCards";
import { reportLocationFilters } from "@/lib/report-workspace";
export const dynamic = "force-dynamic";

/** /reports shows six headline cards; /reports?report=<key> opens the full report library. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("payment:view"), raw = await searchParams;
  const internal = canViewInternalFinance(user);
  if (!raw.report && internal) {
    const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
    const period = (["today", "week", "month", "custom"] as const).find(p => p === one(raw.period)) ?? "month";
    return <ReportCards user={user} period={period} from={one(raw.from)} to={one(raw.to)} />;
  }
  const query = reportLocationFilters(raw.report ? raw : {...raw, report:"ageing"});
  return <ReportCentreClient canInternal={internal} canExport={user.permissions.includes("export:data")} canSupplier={user.accessMode === "ALL" && user.permissions.includes("supplier:view")} canRefund={user.permissions.includes("refund:view")} canTerms={user.permissions.includes("invoice:create")} initialReport={query.report} initialCustomer={query.customerId} initialFilters={query} />;
}
