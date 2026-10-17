import { requirePage } from "@/lib/guard";
import SalesClient from "./SalesClient";
export default async function Page(){await requirePage("customer:view");return <SalesClient/>;}
