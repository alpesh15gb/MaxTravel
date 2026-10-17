import {headers} from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import Shell from "@/components/Shell";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if(process.env.CRM_REQUIRE_MFA==="true" && !session.mfaEnabled && (await headers()).get("x-crm-route")!=="/account-security")redirect("/account-security");
  const agency = await prisma.settings.findUnique({ where: { key: "agency.name" } });
  return <Shell user={session} agencyName={agency?.value ?? "Agency workspace"}>{children}</Shell>;
}
