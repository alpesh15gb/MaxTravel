import {requirePage} from "@/lib/guard";
import WorkHome from "@/components/WorkHome";
export const dynamic="force-dynamic";
export default async function DashboardPage({searchParams}:{searchParams:Promise<{denied?:string}>}){const user=await requirePage("dashboard:view"),q=await searchParams;return <WorkHome user={user} denied={Boolean(q.denied)}/>;}
