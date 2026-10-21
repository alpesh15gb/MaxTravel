import { redirect } from "next/navigation";
import { requirePage } from "@/lib/guard";
import { accessModeFor } from "@/lib/rbac";
import PackagesClient from "./PackagesClient";
export default async function Page() {
  const user = await requirePage("settings:manage");
  if ((user.accessMode ?? accessModeFor(user.role)) !== "ALL") redirect("/dashboard?denied=settings%3Amanage");
  return <PackagesClient />;
}
