import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

const ANCHOR: Record<string, string> = { money: "#money", work: "#todos", documents: "#documents", history: "#history" };

/** The Max ID page moved to /trips/<id>. Old links, bookmarks and notifications land there. */
export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params, sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ["view", "q", "owner", "service", "page", "task"]) if (sp[k]) q.set(k, sp[k]!);
  if (sp.tab === "history" || sp.history) q.set("history", sp.history ?? "1");
  const s = q.toString();
  redirect(`/trips/${encodeURIComponent(id)}${s ? `?${s}` : ""}${ANCHOR[sp.tab ?? ""] ?? ""}`);
}
