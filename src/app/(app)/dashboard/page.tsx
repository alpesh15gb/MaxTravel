import { dayChipLabel } from "@/lib/dates";
import DashboardClient from "./DashboardClient";

// Rendered per request: the "today" chip is computed here so the client never formats a date on
// its own (Node and Chromium disagree about `en-IN` output, which caused a hydration error).
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardClient todayLabel={dayChipLabel(new Date())} />;
}
