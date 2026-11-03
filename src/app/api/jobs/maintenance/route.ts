import {refreshPendingCollections,processCollections} from "@/lib/collections";
import {processCustomerEmail} from "@/lib/customer-email";
import {closeFinishedCases} from "@/lib/case-completion";
import { scheduleWork } from "@/lib/work-system";
import { randomUUID } from "node:crypto";
import { bearerMatches } from "@/lib/worker-auth";
import { prisma } from "@/lib/db";
export async function POST(req: Request) {
  if (!bearerMatches(req, process.env.CRM_WORKER_SECRET)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const key = "maintenance.worker.lease", token = `${Date.now()}:${randomUUID()}`;
  const acquired = await prisma.$transaction(async tx => {
    const row = await tx.settings.findUnique({ where: { key } });
    if (row && Date.now()-Number(row.value.split(":")[0])<300000) return false;
    await tx.settings.upsert({ where: { key }, create: { key, value: token }, update: { value: token } });
    return true;
  });
  if (!acquired) return Response.json({ ok: true, busy: true });
  try {
    const failed:string[]=[],results:Record<string,unknown>={};
    // A gateway outage must not block unrelated email, daily work.
    for(const [name,run]of [
      ["work",()=>scheduleWork()],
      ["completion",()=>closeFinishedCases(prisma)],
      ["collectionRefresh",()=>refreshPendingCollections(prisma)],
      ["collections",()=>processCollections(prisma)],
      ["email",()=>processCustomerEmail(prisma)],
    ] as const){try{const value=await run();if(value&&typeof value==="object")Object.assign(results,value);}catch{failed.push(name);}}
    return Response.json({ok:failed.length===0,...results,...(failed.length?{failed}:{} )},{status:failed.length?503:200});
  } catch { return Response.json({ error: "Maintenance failed. Check the database and configured services." }, { status: 500 }); }
  finally { await prisma.settings.deleteMany({ where: { key, value: token } }); }
}
