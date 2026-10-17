import {requirePage} from "@/lib/guard";
import CustomerTools from "./CustomerTools";
export default async function Page(){await requirePage("customer:create");return <CustomerTools/>;}
