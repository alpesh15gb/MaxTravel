import {requirePage} from "@/lib/guard";
import IncomingClient from "./IncomingClient";
export default async function Page(){const user=await requirePage("whatsapp:view");return <IncomingClient canRetrieve={user.permissions.includes("document:upload")&&user.permissions.includes("sensitive:view")}/>;}
