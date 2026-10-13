import { prisma } from "@/lib/db";
import { requireSession,assertCan,ApiError,jsonError } from "@/lib/guard";
import { accountCustomerScope,buildAccountReport } from "@/lib/account-reports";
import { accountCsv,accountWorkbook,accountPdf } from "@/lib/report-export";
import { audit } from "@/lib/audit";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(req:Request){try{
 const user=await requireSession("payment:view");const params=new URL(req.url).searchParams;
 if(params.get("options")==="1"){
  const [customers,suppliers,cutover]=await Promise.all([
   prisma.customer.findMany({where:accountCustomerScope(user),select:{id:true,name:true,code:true},orderBy:{name:"asc"}}),
   user.accessMode==="ALL"&&user.permissions.includes("supplier:view")?prisma.supplier.findMany({select:{id:true,name:true},orderBy:{name:"asc"}}):Promise.resolve([]),
   prisma.settings.findUnique({where:{key:"financialJournal.cutover"}}),
  ]);
  return Response.json({customers,suppliers,cutover:cutover?.value??null},{headers:{"Cache-Control":"no-store"}});
 }
 const format=params.get("format")||"json";
 if(!["json","csv","xlsx","pdf"].includes(format))throw new ApiError(400,"Choose JSON, CSV, XLSX or PDF.");
 const exporting=format!=="json";if(exporting)assertCan(user,"export:data");
 const report=await buildAccountReport(user,params,exporting);
 if(!exporting)return Response.json(report,{headers:{"Cache-Control":"no-store"}});
 // Customer-facing PDF is deliberately restricted to single-party statements.
 if(format==="pdf"&&!["statement","supplier-statement"].includes(params.get("report")||"statement"))throw new ApiError(400,"PDF is available for customer and supplier statements; use Excel/CSV for registers.");
 const body=format==="csv"?accountCsv(report):format==="xlsx"?await accountWorkbook(report):await accountPdf(report);
 await audit(user,"EXPORT","FinancialReport",params.get("report")||"statement",`${report.period.from}–${report.period.to}; ${report.totalRows} rows; ${format}`);
 return new Response(typeof body==="string"?body:new Uint8Array(body),{headers:{"Content-Type":format==="csv"?"text/csv; charset=utf-8":format==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf","Content-Disposition":`attachment; filename="${params.get("report")||"statement"}-${report.period.to}.${format}"`,"Cache-Control":"no-store"}});
}catch(e){return jsonError(e);}}
