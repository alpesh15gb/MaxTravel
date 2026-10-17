import {requirePage} from "@/lib/guard";
import AdvancesClient from "./AdvancesClient";
export default async function Page(){await requirePage("payment:view");return <AdvancesClient/>;}
