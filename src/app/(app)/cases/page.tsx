import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/** The Max ID register moved to /trips. Search and customer filters carry over. */
export default async function CasesPage({ searchParams }: { searchParams: Promise<{ q?: string; customer?: string; action?: string }> }) {
  const sp = await searchParams;
  if (sp.action === "new") redirect(sp.customer ? `/trips/new?customer=${encodeURIComponent(sp.customer)}` : "/trips/new");
  const q = new URLSearchParams();
  if (sp.q) q.set("q", sp.q);
  if (sp.customer) q.set("customer", sp.customer);
  const s = q.toString();
  redirect(`/trips${s ? `?${s}` : ""}`);
}
