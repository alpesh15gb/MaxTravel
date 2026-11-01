import { requirePage } from "@/lib/guard";
import StartWork from "../work/StartWork";

export default async function StartWorkPage() {
  const user = await requirePage("dashboard:view");
  return <StartWork permissions={user.permissions} />;
}
