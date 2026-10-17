import { requirePage } from "@/lib/guard";
import SecurityClient from "./SecurityClient";
export default async function Page(){await requirePage();return <SecurityClient/>;}
