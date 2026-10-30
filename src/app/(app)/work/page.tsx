import { requirePage } from "@/lib/guard";
import StartWork from "./StartWork";
export const dynamic = "force-dynamic";
export default async function WorkPage() {
  const user = await requirePage();
  return <StartWork permissions={user.permissions}/>;
}
