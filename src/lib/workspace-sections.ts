import type { IconName } from "@/components/Icon";
import type { Permission } from "./permissions";

export type SectionId = "today" | "customers" | "operations" | "finance" | "reports" | "administration";
export type WorkspaceLink = { href: string; label: string; description: string; icon: IconName; permission: Permission };
export type WorkspaceSection = { id: SectionId; title: string; description: string; icon: IconName; href: string; links: WorkspaceLink[] };
const LEGACY_SECTIONS: WorkspaceSection[] = [
  { id: "today", title: "Home", description: "Priorities, appointments and follow-ups for your working day.", icon: "dashboard", href: "/dashboard", links: [
    { href: "/dashboard", label: "Daily overview", description: "See the next decisions and follow-ups.", icon: "dashboard", permission: "dashboard:view" },
    { href: "/tasks", label: "Follow-up diary", description: "Plan, assign and complete the next action.", icon: "tasks", permission: "task:view" },
    { href: "/notifications", label: "Notifications", description: "Review updates to your work.", icon: "bell", permission: "dashboard:view" },
  ] },
  { id: "customers", title: "Max IDs", description: "Start at the customer, register a Max ID and follow the complete journey.", icon: "customers", href: "/cases", links: [
    { href: "/cases", label: "Max IDs & journeys", description: "One permanent Max ID from first contact to completion.", icon: "compass", permission: "customer:view" },
    { href: "/customers", label: "Customers", description: "Customer details, travellers and related work.", icon: "customers", permission: "customer:view" },
    { href: "/sales", label: "Enquiries & quotes", description: "Prepare options and follow the customer's decision.", icon: "compass", permission: "customer:view" },
  ] },
  { id: "operations", title: "Work", description: "Manage bookings, visa applications and the documents needed to deliver them.", icon: "plane", href: "/work", links: [
    { href: "/work/service-alerts", label: "Service alerts", description: "Sales handoffs, holds, appointments and source exceptions.", icon: "bell", permission: "dashboard:view" },
    { href: "/work", label: "Work register", description: "Assign, execute, review and follow up work.", icon: "tasks", permission: "task:view" },
    { href: "/ticketing", label: "Travel bookings", description: "Itineraries, stays, confirmations and servicing.", icon: "plane", permission: "ticketing:view" },
    { href: "/online-bookings", label: "Online bookings", description: "Transactions received from the booking app.", icon: "plane", permission: "ticketing:view" },
    { href: "/visa", label: "Visa applications", description: "Applicants, appointments and application stages.", icon: "visa", permission: "visa:view" },
    { href: "/documents", label: "Document verification", description: "Review documents against the client's requirements.", icon: "documents", permission: "document:view" },
  ] },
  { id: "finance", title: "Finance", description: "Record and reconcile customer money, supplier payments and refunds.", icon: "wallet", href: "/workspace/finance", links: [
    { href: "/payments", label: "Invoices & receipts", description: "Issue invoices and allocate money actually received.", icon: "wallet", permission: "payment:view" },
    { href: "/advances", label: "Customer advances", description: "Allocate existing customer credit to open work.", icon: "wallet", permission: "payment:view" },
    { href: "/refunds", label: "Refunds", description: "Approval, supplier recovery and actual payouts.", icon: "refund", permission: "refund:view" },
    { href: "/suppliers", label: "Supplier accounts", description: "Supplier bills, settlements and balances.", icon: "suppliers", permission: "supplier:view" },
  ] },
  { id: "reports", title: "Reports", description: "Answer business questions with dated, scoped reports and complete exports.", icon: "audit", href: "/reports/work", links: [
    { href: "/reports/work", label: "Work & team reports", description: "Staff workload, outcomes and unfinished work.", icon: "tasks", permission: "task:view" },
    { href: "/reports", label: "Reports & insights", description: "Sales, collections, balances and operational performance.", icon: "audit", permission: "payment:view" },
  ] },
  { id: "administration", title: "Settings", description: "Maintain team access, agency defaults, service checklists and your catalogue.", icon: "settings", href: "/workspace/administration", links: [
    { href: "/employees", label: "Team & access", description: "Staff records, roles and account status.", icon: "customers", permission: "employee:view" },
    { href: "/work/settings", label: "Work templates & rules", description: "Service steps, reviews and staff reminder calendar.", icon: "tasks", permission: "settings:manage" },
    { href: "/settings", label: "Agency settings", description: "Agency, case-management and invoicing defaults.", icon: "settings", permission: "settings:manage" },
    { href: "/checklists", label: "Visa checklists", description: "Requirements for each destination and visa type.", icon: "check", permission: "checklist:view" },
    { href: "/travel-packages", label: "Travel packages", description: "Prepare and publish the customer-facing catalogue.", icon: "compass", permission: "settings:manage" },
    { href: "/imports", label: "Client & case import", description: "Map existing clients, travellers and case journeys with a reviewed preview.", icon: "customers", permission: "settings:manage" },
    { href: "/customer-tools", label: "Customer duplicate review", description: "Preview simple customer CSVs and review duplicate profiles.", icon: "customers", permission: "customer:create" },
    { href: "/audit", label: "Audit trail", description: "Review recorded changes and their actors.", icon: "audit", permission: "audit:view" },
  ] },
];

const legacy=(id:SectionId)=>LEGACY_SECTIONS.find(s=>s.id===id)!;
export const WORKSPACE_SECTIONS:WorkspaceSection[]=[
 {...legacy("customers"),title:"Masters",href:"/masters",description:"Customer details, travellers, documents and staff activity.",links:[{href:"/masters",label:"Customer masters",description:"Complete customer and traveller profiles.",icon:"customers",permission:"customer:view"},{href:"/email",label:"Customer email",description:"Queued updates, failures and delivery review.",icon:"message",permission:"email:send"},...legacy("operations").links.filter(l=>l.href==="/documents")]},
 {...legacy("operations"),title:"Bookings",href:"/ticketing",description:"Create and manage travel bookings and visa work.",links:legacy("operations").links.filter(l=>["/ticketing","/online-bookings","/visa"].includes(l.href)).concat(legacy("customers").links.filter(l=>["/cases","/sales"].includes(l.href)),legacy("finance").links.filter(l=>l.href!=="/suppliers"))},
 {...legacy("today"),title:"Tasks & follow-ups",href:"/work",description:"Assign, perform and follow up daily work.",links:[{href:"/work",label:"Work register",description:"One queue for assigned work.",icon:"tasks",permission:"task:view"},...legacy("today").links,...legacy("operations").links.filter(l=>l.href==="/work/service-alerts")]},
 {...legacy("finance"),title:"Suppliers",href:"/suppliers",description:"Supplier accounts, due dates and settlements.",links:legacy("finance").links.filter(l=>l.href==="/suppliers")},
 {...legacy("reports"),title:"Reporting",href:"/reports/work",description:"Operational and financial reports and exports."},
];

export function availableSections(permissions: readonly string[]) {
  return WORKSPACE_SECTIONS.map(section => ({ ...section, links: section.links.filter(link => permissions.includes(link.permission)) })).filter(section => section.links.length > 0).map(section=>({...section,href:section.links.some(link=>link.href===section.href)?section.href:section.links[0].href}));
}
export const findSection = (id: string) => WORKSPACE_SECTIONS.find(section => section.id === id) ?? LEGACY_SECTIONS.find(section=>section.id===id);
export function sectionForPath(path: string) {
  if(path==="/team-chat")return findSection("today");
  if(path==="/customers"||path.startsWith("/customers/"))return findSection("customers");
  if(path.startsWith("/settings")||path.startsWith("/employees")||path.startsWith("/audit")||path.startsWith("/imports")||path.startsWith("/checklists")||path.startsWith("/work/settings")) return findSection("administration");
  return WORKSPACE_SECTIONS.find(section => path === section.href || section.links.some(link => path === link.href || path.startsWith(link.href + "/"))) ??
    (path.startsWith("/visa-requirements") ? findSection("operations") : undefined);
}
export function sectionForKind(kind: string): SectionId {
  if (/SALES|CASE_FOLLOW/.test(kind)) return "operations";
  if (/SUPPLIER/.test(kind)) return "finance";
  if (/PAYMENT|REFUND|INVOICE|CAPPED_DUES/.test(kind)) return "operations";
  if (/TASK/.test(kind)) return "today";
  return "operations";
}
