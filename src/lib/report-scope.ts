import type { Prisma } from "@prisma/client";
import { scopeWhere } from "./guard";
import type { SessionUser } from "./session";

/** Complete customer accounts only: do not leak another owner's work through a statement. */
export function accountCustomerScope(user:SessionUser):Prisma.CustomerWhereInput {
 const base=scopeWhere(user,null,undefined,"assignedToId") as Prisma.CustomerWhereInput;
 if(user.accessMode==="ALL")return base;
 const work=scopeWhere(user,null,"ownerId");
 return {AND:[base,{bookings:{none:{NOT:work}}},{visaCases:{none:{NOT:work}}}]};
}

