import {requirePage} from "@/lib/guard";
import WorkHome from "@/components/WorkHome";
export const dynamic="force-dynamic";
export default async function DashboardPage(){return <WorkHome user={await requirePage("dashboard:view")}/>;}
