import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/** The home screen moved to /today. The "access denied" banner travels with the redirect. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const q = await searchParams;
  redirect(q.denied ? "/today?denied=1" : "/today");
}
