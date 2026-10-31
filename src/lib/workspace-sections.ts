import type { IconName } from "@/components/Icon";
import type { Permission } from "./permissions";

export type SectionId = "today" | "customers" | "operations" | "finance" | "communications" | "reports" | "administration";
export type WorkspaceLink = { href: string; label: string; description: string; icon: IconName; permission: Permission };
export type WorkspaceSection = { id: SectionId; title: string; description: string; icon: IconName; href: string; links: WorkspaceLink[] };
export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { id: "today", title: "Today / My work", description: "Priorities, appointments and follow-ups for your working day.", icon: "dashboard", href: "/dashboard", links: [
    { href: "/dashboard", label: "Daily overview", description: "See the next decisions and follow-ups.", icon: "dashboard", permission: "dashboard:view" },
    { href: "/tasks", label: "Tasks & follow-ups", description: "Plan, assign and complete the next action.", icon: "tasks", permission: "task:view" },
    { href: "/notifications", label: "Notifications", description: "Review updates to your work.", icon: "bell", permission: "dashboard:view" },
  ] },
  { id: "customers", title: "Customers & cases", description: "Start at the customer, register a case ID and follow the complete journey.", icon: "customers", href: "/workspace/customers", links: [
    { href: "/cases", label: "Cases & journeys", description: "One permanent case ID from first contact to completion.", icon: "compass", permission: "customer:view" },
    { href: "/customers", label: "Customers", description: "Customer details, travellers and related work.", icon: "customers", permission: "customer:view" },
    { href: "/sales", label: "Enquiries & quotes", description: "Prepare options and follow the customer's decision.", icon: "compass", permission: "customer:view" },
  ] },
  { id: "operations", title: "Travel operations", description: "Manage bookings, visa applications and the documents needed to deliver them.", icon: "plane", href: "/workspace/operations", links: [
    { href: "/ticketing", label: "Flights & hotels", description: "Itineraries, stays, confirmations and servicing.", icon: "plane", permission: "ticketing:view" },
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
  { id: "communications", title: "Communications", description: "Customer conversations and received files, ready to link to the right journey.", icon: "message", href: "/workspace/communications", links: [
    { href: "/whatsapp", label: "WhatsApp desk", description: "Conversations, consent and message delivery.", icon: "message", permission: "whatsapp:view" },
    { href: "/incoming-documents", label: "Incoming documents", description: "Identify, scan and file received PDFs and images.", icon: "documents", permission: "whatsapp:view" },
  ] },
  { id: "reports", title: "Reports", description: "Answer business questions with dated, scoped reports and complete exports.", icon: "audit", href: "/reports", links: [
    { href: "/reports", label: "Reports & insights", description: "Sales, collections, balances and operational performance.", icon: "audit", permission: "payment:view" },
  ] },
  { id: "administration", title: "Administration", description: "Maintain team access, agency defaults, service checklists and your catalogue.", icon: "settings", href: "/workspace/administration", links: [
    { href: "/employees", label: "Team & access", description: "Staff records, roles and account status.", icon: "customers", permission: "employee:view" },
    { href: "/settings", label: "Agency settings", description: "Agency, case-management and invoicing defaults.", icon: "settings", permission: "settings:manage" },
    { href: "/checklists", label: "Visa checklists", description: "Requirements for each destination and visa type.", icon: "check", permission: "checklist:view" },
    { href: "/travel-packages", label: "Travel packages", description: "Prepare and publish the customer-facing catalogue.", icon: "compass", permission: "settings:manage" },
    { href: "/customer-tools", label: "Customer import", description: "Preview and reconcile imported customer records.", icon: "customers", permission: "customer:create" },
    { href: "/audit", label: "Audit trail", description: "Review recorded changes and their actors.", icon: "audit", permission: "audit:view" },
  ] },
];

export function availableSections(permissions: readonly string[]) {
  return WORKSPACE_SECTIONS.map(section => ({ ...section, links: section.links.filter(link => permissions.includes(link.permission)) })).filter(section => section.links.length > 0);
}
export const findSection = (id: string) => WORKSPACE_SECTIONS.find(section => section.id === id);
export function sectionForPath(path: string) {
  return WORKSPACE_SECTIONS.find(section => path === section.href || section.links.some(link => path === link.href || path.startsWith(link.href + "/"))) ??
    (path.startsWith("/visa-requirements") ? findSection("operations") : undefined);
}
export function sectionForKind(kind: string): SectionId {
  if (/SALES|CASE_FOLLOW/.test(kind)) return "customers";
  if (/PAYMENT|REFUND|SUPPLIER|INVOICE|CAPPED_DUES/.test(kind)) return "finance";
  if (/WHATSAPP|MESSAGE|CAPPED_THREADS/.test(kind)) return "communications";
  if (/TASK/.test(kind)) return "today";
  return "operations";
}
