import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/session";
import AuthLayout from "@/components/AuthLayout";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams: pending }: { searchParams: Promise<{ created?: string }> }) {
  const searchParams = await pending;
  if (!(await prisma.user.count())) redirect("/setup");
  if (await getServerSession()) redirect("/dashboard");
  const agency = await prisma.settings.findUnique({ where: { key: "agency.name" } });
  return <AuthLayout><LoginForm agencyName={agency?.value ?? "Your agency"} created={searchParams.created === "1"} /></AuthLayout>;
}
