import { DEFAULT_PAYMENT_TEMPLATE, PAYMENT_TEMPLATE_KEY } from "@/lib/whatsapp-templates";
import { messagingConfig } from "@/lib/whatsapp-provider";
import { automationRules } from "@/lib/whatsapp-queue";
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
    prisma.whatsAppThread.findMany({ where: { customer: { is: where } }, include: { customer: { select: { id: true, name: true, code: true } }, msgs: { orderBy: { at: "desc" }, take: 100, include: { attachment:{select:{id:true,filename:true}},staff: { select: { name: true } } } } }, orderBy: { lastMsgAt: "desc" } }),
    prisma.customer.findMany({ where, select: { id: true, name: true, phone: true, whatsappOptIn: true }, orderBy: { name: "asc" } }),
    prisma.quickReply.findMany({ orderBy: { title: "asc" } }),
  ]);
  const rules = await automationRules();
  const canManage = user.permissions.includes("settings:manage");
  const paymentTemplate = canManage ? (await prisma.settings.findUnique({ where: { key: PAYMENT_TEMPLATE_KEY } }))?.value ?? DEFAULT_PAYMENT_TEMPLATE : DEFAULT_PAYMENT_TEMPLATE;
  const unmatched = canManage ? await prisma.whatsAppInbound.findMany({ where: { matched: false }, orderBy: { at: "desc" }, take: 50, select: { id: true, phone: true, body: true, reason: true } }) : [];
  return <WhatsAppInbox paymentTemplate={paymentTemplate} configured={Boolean(messagingConfig())} canManage={canManage} rules={rules} unmatched={unmatched} customers={customers} templates={Array.from(new Map([...QUICK_REPLY_DEFAULTS, ...templates].map(t=>[t.key,{key:t.key,title:t.title,body:t.body}])).values())} canSend={user.permissions.includes("whatsapp:send")} selectedThread={searchParams.thread ?? null} selectedCustomer={searchParams.customer ?? null} threads={threads.map(t=>({id:t.id,customerId:t.customerId,customerName:t.customer.name,customerCode:t.customer.code,phone:t.phone,unread:t.unread,awaitingReply:t.msgs[0]?.direction==="IN",lastAt:t.lastMsgAt.toISOString(),messages:t.msgs.slice().reverse().map(m=>({id:m.id,direction:m.direction,body:m.body,at:m.at.toISOString(),status:m.status,template:m.template,staff:m.staff?.name??null,lastError:m.lastError,attachment:m.attachment}))}))}/>;
}
