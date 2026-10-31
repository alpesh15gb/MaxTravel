import type { SessionUser } from "./session";
import type { computePulse } from "./pulse";
import type { IconName } from "@/components/Icon";
import { availableSections, findSection, sectionForKind, type SectionId } from "./workspace-sections";
import { availableWorkActions } from "./workspace-guide";

export type WorkspaceStat = { label: string; value: string; href: string; note: string; icon: IconName };
export function overviewFor(pulse: Awaited<ReturnType<typeof computePulse>>, sectionId: SectionId, user: SessionUser) {
  const section = findSection(sectionId)!;
  const sections = availableSections(user.permissions);
  const links = sections.find(s => s.id === sectionId)?.links ?? [];
  const items = sectionId === "today" ? pulse.items : pulse.items.filter(item => sectionForKind(item.kind) === sectionId);
  const followups = pulse.items.filter(item => /^(CASE_FOLLOWUP|TASK_(?:OVERDUE|DUE_TODAY)|SALES_FOLLOW_UP|LIST_CAPPED_(?:TASKS|CASE_FOLLOW|SALES))/.test(item.kind));
  const stats: WorkspaceStat[] = [];
  const add = (label: string, value: number | null, href: string, icon: IconName, note: string) => { if (value !== null) stats.push({ label, value: String(value), href, icon, note }); };
  if (sectionId === "today" || sectionId === "customers") add("Active cases", pulse.workspaceStats.activeCases, "/cases", "compass", "Open client journeys in your access scope");
  if (sectionId === "today") {
    add("Due follow-ups", pulse.workspaceStats.dueFollowups, "/dashboard?view=followups", "tasks", "Due today in India, including overdue work");
    if(pulse.workspaceStats.activeCases!==null||pulse.workspaceStats.dueFollowups!==null||pulse.workspaceStats.unread!==null) add("Urgent priorities", items.filter(i => i.severity === "URGENT").length, "/dashboard?view=all&priority=URGENT", "clock", "In the current attention queue");
    add("Unread messages", pulse.workspaceStats.unread, "/whatsapp", "message", "Across your accessible customer conversations");
  } else if (sectionId === "customers") {
    add("Customers", pulse.workspaceStats.customers, "/customers", "customers", "Records you are permitted to view");
    add("Case follow-ups shown", items.filter(i => i.kind === "CASE_FOLLOWUP").length, "/cases", "tasks", "Due and overdue cases in this queue");
    add("Sales actions shown", items.filter(i => /SALES/.test(i.kind)).length, "/sales", "compass", "Enquiries and quotation decisions to review");
  } else if (sectionId === "operations" || sectionId === "finance") {
    const allowed = sectionId === "operations" ? ["/visa", "/ticketing"] : ["/payments"];
    for (const k of pulse.kpis.filter(k => allowed.includes(k.href)&&links.some(link=>link.href===k.href))) stats.push({ label:k.label,value:k.value,href:k.href,note:k.note,icon:k.icon as IconName });
    add("Actions shown", items.filter(i => !i.kind.startsWith("LIST_CAPPED")).length, section.href, section.icon, "Current queue; open a module for its full list");
  } else if (sectionId === "communications") {
    add("Unread messages", pulse.workspaceStats.unread, "/whatsapp", "message", "Across your accessible customer conversations");
    add("Replies to review", items.filter(i => i.kind === "UNANSWERED_WHATSAPP").length, "/whatsapp", "clock", "Older unanswered conversations in this queue");
  }
  const caseServices = user.permissions.includes("customer:view") ? [
    ...(user.permissions.includes("visa:create") ? ["VISA"] : []),
    ...(user.permissions.includes("ticketing:create") ? ["FLIGHT", "HOTEL"] : []),
  ] : [];
  const actionSections: Record<string, SectionId> = {case:"customers",customer:"customers",enquiry:"customers",followup:"today",booking:"operations",hotel:"operations",visa:"operations",online:"operations",documents:"communications",payment:"finance",invoice:"finance",advance:"finance",supplier:"finance",refund:"finance",report:"reports"};
  const actions = availableWorkActions(user.permissions).filter(action => action.id !== "case" && actionSections[action.id] === sectionId);
  return {
    section:{id:section.id,title:section.title,description:section.description,href:section.href},
    name:pulse.name,mode:["OWNER","SUPER_ADMIN","BRANCH_MANAGER"].includes(user.role)?"agency":"personal",
    scope:user.accessMode==="ASSIGNED"?"Assigned to you":user.accessMode==="BRANCH"?"Your branch":"Your accessible records",
    stats,links,sections:sections.map(({id,title,description,icon,href})=>({id,title,description,icon,href})),
    items,followups:sectionId==="today"?followups:[],actions,caseServices:sectionId==="today"||sectionId==="customers"?caseServices:[],
    generatedAt:pulse.generatedAt,firstRun:pulse.firstRun,canAddCustomer:user.permissions.includes("customer:create"),
  };
}
export type WorkspaceOverview = ReturnType<typeof overviewFor>;
export const sectionPermissions = (id: SectionId) => id === "today" ? ["dashboard:view" as const] : findSection(id)!.links.map(link => link.permission);
