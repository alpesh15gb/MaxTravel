import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import WhatsAppInbox from "./WhatsAppInbox";
import { QUICK_REPLY_DEFAULTS } from "@/lib/whatsapp";
export const dynamic = "force-dynamic";
export default async function WhatsAppPage({ searchParams: pending }: { searchParams: Promise<{ thread?: string; customer?: string }> }) {
  const searchParams = await pending;
  const user = await requirePage("whatsapp:view");
  const where = scopeWhere(user, null, undefined, "assignedToId");
  const [threads, customers, templates] = await Promise.all([
    prisma.whatsAppThread.findMany({ where: { customer: { is: where } }, include: { customer: { select: { id: true, name: true, code: true } }, msgs: { orderBy: { at: "desc" }, take: 100 } }, orderBy: { lastMsgAt: "desc" } }),
    prisma.customer.findMany({ where, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    prisma.quickReply.findMany({ orderBy: { title: "asc" } }),
  ]);
  return <WhatsAppInbox customers={customers} templates={Array.from(new Map([...QUICK_REPLY_DEFAULTS, ...templates].map(t=>[t.key,{key:t.key,title:t.title,body:t.body}])).values())} canSend={user.permissions.includes("whatsapp:send")} selectedThread={searchParams.thread ?? null} selectedCustomer={searchParams.customer ?? null} threads={threads.map(t=>({id:t.id,customerId:t.customerId,customerName:t.customer.name,customerCode:t.customer.code,phone:t.phone,unread:t.unread,awaitingReply:t.msgs[0]?.direction==="IN",lastAt:t.lastMsgAt.toISOString(),messages:t.msgs.slice().reverse().map(m=>({id:m.id,direction:m.direction,body:m.body,at:m.at.toISOString(),status:m.status,template:m.template}))}))}/>;
}
