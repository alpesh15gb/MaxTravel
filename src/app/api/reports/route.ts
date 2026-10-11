import { requireSession, jsonError, assertCan } from "@/lib/guard";
import { buildReport } from "@/lib/reports";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
export async function GET(req:Request) {
  try {
    const user=await requireSession("payment:view");
    const params=new URL(req.url).searchParams;
    const exporting=params.get("format")==="csv";
    if(exporting)assertCan(user,"export:data");
    const report=await buildReport(user,params);
    if(!exporting)return Response.json(report);
    const rows:unknown[][]=[["Max Travel CRM report",report.period.from,report.period.to],["Metric","INR / count"],["Sales value",report.sales],["Receipts",report.collected],["Paid refunds",report.returned],["Net collections",report.netCollections],["Current receivables",report.receivables.total],["Costed booking margin",report.margin],["Uncosted bookings",report.uncosted],[],["Month","Sales INR","Collections INR"],...report.trend.map(t=>[t.month,t.sales,t.collections]),[],["Booking status","Count"],...report.pipeline.map(t=>[t.label,t.value]),[],["Visa stage","Count"],...report.visaStages.map(t=>[t.label,t.value]),[],["Payment mode","INR"],...report.modes.map(t=>[t.label,t.value]),[],["Task status","Count"],...report.tasks.map(t=>[t.label,t.value])];
    const escape=(value:unknown)=>'"'+String(value??"").replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
    await audit(user,"EXPORT","reports",undefined,`${report.period.from} to ${report.period.to}`);
    return new Response("\uFEFF"+rows.map(row=>row.map(escape).join(",")).join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="agency-report-${report.period.from}-${report.period.to}.csv"`}});
  }catch(e){return jsonError(e,"reports");}
}
