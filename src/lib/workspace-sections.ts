import type { IconName } from "@/components/Icon";
import type { Permission } from "./permissions";

export type SectionId = "today" | "trips" | "customers" | "suppliers" | "reports" | "operations" | "finance" | "administration";
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

const link=(href:string,label:string,description:string,icon:IconName,permission:Permission):WorkspaceLink=>({href,label,description,icon,permission});
export const WORKSPACE_SECTIONS:WorkspaceSection[]=[
 {id:"today",title:"Today",href:"/today",icon:"dashboard",description:"What needs doing now: your to-dos, travel this week, money to collect and follow-ups.",links:[
  link("/today","Today","What needs doing now.","dashboard","dashboard:view"),
  link("/work","To-dos","Assign, do and follow up to-dos.","tasks","task:view"),
  link("/work/service-alerts","Alerts","Holds, appointments and handoffs that need attention.","bell","dashboard:view"),
  link("/notifications","Notifications","Updates to your work.","bell","dashboard:view"),
 ]},
 {id:"trips",title:"Trips",href:"/trips",icon:"compass",description:"Every customer job under one Max ID: enquiry, quote, bookings, visa and payment.",links:[
  link("/trips","All trips","Every trip under its Max ID.","compass","customer:view"),
  link("/sales","Enquiries","Enquiries and quotes.","compass","customer:view"),
  link("/ticketing","Flights & hotels","Flight, hotel and other bookings.","plane","ticketing:view"),
  link("/visa","Visas","Visa applications.","visa","visa:view"),
  link("/online-bookings","Online","Bookings from the booking site.","plane","ticketing:view"),
  link("/payments","Payments","Invoices and receipts.","wallet","payment:view"),
  link("/refunds","Refunds","Refund approvals and payouts.","refund","refund:view"),
 ]},
 {id:"customers",title:"Customers",href:"/masters",icon:"customers",description:"Customer details, travellers and their documents.",links:[
  link("/masters","Customers","Find or add a customer, their travellers and documents.","customers","customer:view"),
  link("/email","Customer email","Queued updates, failures and delivery review.","message","email:send"),
 ]},
 {id:"suppliers",title:"Suppliers",href:"/suppliers",icon:"suppliers",description:"Supplier accounts, payables and settlements.",links:[
  link("/suppliers","Suppliers","Supplier bills, settlements and balances.","suppliers","supplier:view"),
 ]},
 {id:"reports",title:"Reports",href:"/reports",icon:"audit",description:"Profit, collections, payables and team reports.",links:[
  link("/reports","Reports","Profit, sales, collections and payables.","audit","payment:view"),
  link("/reports/work","Team reports","Staff workload and unfinished to-dos.","tasks","task:view"),
 ]},
];
export const QUICK_ACTIONS:{href:string;label:string;icon:IconName;perm:Permission}[]=[
 {href:"/trips/new",label:"New trip",icon:"compass",perm:"customer:view"},
 {href:"/masters?action=new",label:"New customer",icon:"customers",perm:"customer:create"},
 {href:"/today?action=todo",label:"New to-do",icon:"tasks",perm:"task:create"},
];
const PATHS:[SectionId,string[]][]=[
 ["today",["/today","/dashboard","/work","/tasks","/notifications","/team-chat"]],
 ["trips",["/trips","/cases","/ticketing","/visa","/visa-requirements","/sales","/online-bookings","/payments","/refunds","/advances","/documents","/start-work"]],
 ["customers",["/masters","/customers","/customer-tools","/email"]],
 ["suppliers",["/suppliers"]],
 ["reports",["/reports"]],
];
const ADMIN=["/settings","/employees","/audit","/imports","/checklists","/work/settings","/travel-packages","/workspace"];
const under=(path:string,root:string)=>path===root||path.startsWith(root+"/");

export function availableSections(permissions: readonly string[]) {
  return WORKSPACE_SECTIONS.map(section => ({ ...section, links: section.links.filter(link => permissions.includes(link.permission)) })).filter(section => section.links.length > 0).map(section=>({...section,href:section.links.some(link=>link.href===section.href)?section.href:section.links[0].href}));
}
export const findSection = (id: string) => WORKSPACE_SECTIONS.find(section => section.id === id) ?? LEGACY_SECTIONS.find(section=>section.id===id);
export function sectionForPath(path: string) {
  if(ADMIN.some(root=>under(path,root)))return undefined;
  const hit=PATHS.find(([,roots])=>roots.some(root=>under(path,root)));
  return hit?WORKSPACE_SECTIONS.find(section=>section.id===hit[0]):undefined;
}
export function sectionForKind(kind: string): SectionId {
  if (/SUPPLIER/.test(kind)) return "suppliers";
  if (/TASK/.test(kind)) return "today";
  return "trips";
}
