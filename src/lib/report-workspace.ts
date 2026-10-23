/** Shared presentation facts. These do not change financial calculations or access scopes. */
export const REPORT_GROUPS = ["Customer accounts", "Suppliers & refunds", "Sales & operations"] as const;
export type ReportGroup = typeof REPORT_GROUPS[number];
export const REPORT_CATALOGUE = [
  { key: "statement", label: "Customer statement", group: "Customer accounts", hint: "Opening balance, every movement and closing balance.", basis: "Journal effective date · opening balance brought forward", cutoff: true },
  { key: "ageing", label: "Outstanding & ageing", group: "Customer accounts", hint: "Open customer obligations and overdue amounts.", basis: "Balance at the end of the selected India-calendar day", cutoff: true },
  { key: "receipts", label: "Receipts & refunds", group: "Customer accounts", hint: "Dated customer money received and returned.", basis: "Receipt received date / paid-refund date", cutoff: false },
  { key: "supplier-statement", label: "Supplier statement", group: "Suppliers & refunds", hint: "Bills, settlements and running payable balance.", basis: "Journal effective date · opening balance brought forward", cutoff: true },
  { key: "supplier-payables", label: "Supplier payables", group: "Suppliers & refunds", hint: "Open supplier obligations and due dates.", basis: "Balance at the end of the selected India-calendar day", cutoff: true },
  { key: "refunds", label: "Refund exposure", group: "Suppliers & refunds", hint: "Refund requests in the period, with their current status.", basis: "Refund request date · current status, not historical exposure", cutoff: false },
  { key: "cancellations", label: "Cancellations", group: "Suppliers & refunds", hint: "Retained charges, fees, refunds and customer balance.", basis: "Cancellation date · current allocations and lifetime cash for that cohort", cutoff: false },
  { key: "sales", label: "Sales & margin", group: "Sales & operations", hint: "Booking and visa value, pipeline and known cost coverage.", basis: "Booking date / visa creation date · current prices and status", cutoff: false },
  { key: "operations", label: "Work & travel", group: "Sales & operations", hint: "Work opened in the period, with owner, travel dates and deadlines.", basis: "Booking date / visa creation date · not travel-date filtering", cutoff: false },
] as const;
export type ReportKey = typeof REPORT_CATALOGUE[number]["key"];
export const reportDefinition = (key: string) => REPORT_CATALOGUE.find(report => report.key === key);
export const isBalanceReport = (key: string) => key === "ageing" || key === "supplier-payables";
export const isStatementReport = (key: string) => key === "statement" || key === "supplier-statement";
export const isWorkReport = (key: string) => ["sales", "operations", "cancellations"].includes(key);
export const reportCurrency = (key: string) => key === "operations" ? "All currencies · no monetary totals" : "INR";
export const reportProductLabel = (product: string | null | undefined) => {
  switch (product?.trim().toUpperCase()) {
    case "FLIGHT": return "Flight";
    case "HOTEL": return "Hotel";
    default: return "Booking (product not recorded)";
  }
};
export const indiaDay = (value: Date = new Date()) => new Date(value.getTime() + 330 * 60000).toISOString().slice(0, 10);
const shiftDay = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export const REPORT_DATE_PRESETS = [
  { key: "today", label: "Today" }, { key: "last7", label: "Last 7 days" },
  { key: "month", label: "This month" }, { key: "previousMonth", label: "Last month" },
  { key: "last90", label: "Last 90 days" },
] as const;
export type ReportDatePreset = typeof REPORT_DATE_PRESETS[number]["key"];

/** Presets only edit controls. A separate Generate action applies them. */
export function reportDatePreset(key: ReportDatePreset, report: string, cutover: string | null, now = new Date()) {
  const today = indiaDay(now);
  let to = today, from = today;
  if (key === "last7") from = shiftDay(today, -6);
  if (key === "last90") from = shiftDay(today, -89);
  if (key === "month") from = `${today.slice(0, 7)}-01`;
  if (key === "previousMonth") { to = shiftDay(`${today.slice(0, 7)}-01`, -1); from = `${to.slice(0, 7)}-01`; }
  const cutoff = cutover && Number.isFinite(Date.parse(cutover)) ? indiaDay(new Date(cutover)) : null;
  if (reportDefinition(report)?.cutoff && cutoff) {
    if (to < cutoff) return null;
    if (isStatementReport(report) && from < cutoff) from = cutoff;
  }
  // The balance report has only one meaningful date; do not make users maintain an unused From.
  if (isBalanceReport(report)) from = to;
  return { from, to };
}

export type ReportFilters = { report: string; from: string; to: string; customerId: string; supplierId: string; ownerId: string; status: string };
/** Use the same normalized criteria for dirty detection, paging and downloads. */
export function reportFilterQuery(filters: ReportFilters) {
  const supplier = filters.report.startsWith("supplier");
  return new URLSearchParams({ report: filters.report, from: isBalanceReport(filters.report) ? filters.to : filters.from, to: filters.to,
    ...(filters.customerId && !supplier ? { customerId: filters.customerId } : {}),
    ...(filters.supplierId && filters.report === "supplier-statement" ? { supplierId: filters.supplierId } : {}),
    ...(isWorkReport(filters.report) && filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(isWorkReport(filters.report) && filters.status ? { status: filters.status } : {}),
  }).toString();
}

export type ReportMetadata = {
  dateBasis: string;
  currency: string;
  account: string;
  scope: string;
  filters: { label: string; value: string; displayValue?: string }[];
};
