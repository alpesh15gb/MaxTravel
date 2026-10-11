import { randomUUID } from "node:crypto";
import { bearerMatches } from "@/lib/evolution";
import { prisma } from "@/lib/db";
import { scheduleReminders, processWhatsAppQueue } from "@/lib/whatsapp-queue";
export async function POST(req: Request) {
  if (!bearerMatches(req, process.env.WA_WORKER_SECRET)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const key = "whatsapp.worker.lease", token = `${Date.now()}:${randomUUID()}`;
  const acquired = await prisma.$transaction(async tx => {
    const row = await tx.settings.findUnique({ where: { key } });
    if (row && Date.now()-Number(row.value.split(":")[0])<300000) return false;
    await tx.settings.upsert({ where: { key }, create: { key, value: token }, update: { value: token } });
    return true;
  });
  if (!acquired) return Response.json({ ok: true, busy: true });
  try {
    await scheduleReminders();
    return Response.json({ ok: true, ...await processWhatsAppQueue() });
  } catch { return Response.json({ error: "Messaging worker failed. Check database and provider connectivity." }, { status: 500 }); }
  finally { await prisma.settings.deleteMany({ where: { key, value: token } }); }
}
