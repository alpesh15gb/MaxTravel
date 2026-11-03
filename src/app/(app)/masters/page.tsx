import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {prisma} from "@/lib/db";
import {requirePage,scopeWhere} from "@/lib/guard";
import {mapCustomer} from "@/lib/serialize";
import {dateLabel} from "@/lib/dates";
import CustomersClient from "../customers/CustomersClient";
export const dynamic="force-dynamic";
export default async function MastersPage(){const u=await requirePage("customer:view");const customers=await prisma.customer.findMany({where:{mergedIntoId:null,...scopeWhere(u,"branchId",undefined,"assignedToId")},include:{branch:{select:{name:true}},assignedTo:{select:{name:true}}},orderBy:{name:"asc"}});return <CustomersClient recoveryContext={salesRecoveryContext(u)}  heading="Masters" recordBase="/masters" customers={customers.map(c=>({...mapCustomer(c),createdLabel:dateLabel(c.createdAt)}))} canCreate={u.permissions.includes("customer:create")} canExport={u.permissions.includes("export:data")}/>;}
