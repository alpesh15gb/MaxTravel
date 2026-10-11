import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await prisma.user.count())) redirect("/setup");
  const session = await getServerSession();
  redirect(session ? "/dashboard" : "/login");
}
