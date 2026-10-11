import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import AuthLayout from "@/components/AuthLayout";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";
export default async function SetupPage() {
  if (await prisma.user.count()) redirect("/login");
  return <AuthLayout><SetupForm /></AuthLayout>;
}
