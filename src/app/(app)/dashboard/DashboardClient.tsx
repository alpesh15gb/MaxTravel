"use client";
import WorkspaceDashboard from "@/components/WorkspaceDashboard";
export default function DashboardClient({todayLabel}:{todayLabel:string}) {
  return <WorkspaceDashboard todayLabel={todayLabel}/>;
}
