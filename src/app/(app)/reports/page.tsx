import { requirePage } from "@/lib/guard";
import ReportsClient from "./ReportsClient";
export const dynamic="force-dynamic";
export default async function ReportsPage(){const user=await requirePage("payment:view");return <ReportsClient canExport={user.permissions.includes("export:data")}/>;}
