import type { SalesCustomer } from "./sales-workspace";

export type CustomerFields = { name: string; phone: string; email: string; city: string; type: string };
export type CustomerSaveResult =
  | { kind: "created"; id: string }
  | { kind: "rejected"; message: string }
  | { kind: "uncertain" }
  | { kind: "access-changed" };

/** No automatic retries: a network/5xx/malformed-success response may follow a committed write. */
export async function createEnquiryCustomer(fields: CustomerFields, context: string, request: typeof fetch = fetch): Promise<CustomerSaveResult> {
  if (!/^[a-f0-9]{64}$/.test(context)) return { kind: "access-changed" };
  try {
    const response = await request("/api/customers", { method: "POST", headers: { "Content-Type": "application/json", "X-Sales-Recovery-Context": context }, body: JSON.stringify(fields) });
    if ([401, 403].includes(response.status)) return { kind: "access-changed" };
    if (response.status >= 500) return { kind: "uncertain" };
    const body = await response.json().catch(() => null);
    if (body?.code === "SALES_CONTEXT_CHANGED") return { kind: "access-changed" };
    if (!response.ok) return { kind: "rejected", message: typeof body?.error === "string" ? body.error : "Customer was not created. Check the fields before trying again." };
    return typeof body?.id === "string" && body.id.length > 0 && body.id.length <= 200
      ? { kind: "created", id: body.id }
      : { kind: "uncertain" };
  } catch { return { kind: "uncertain" }; }
}

export class CustomerAccessChanged extends Error {
  constructor() { super("Staff session or access changed. Reload this workspace before continuing."); }
}

function isCustomer(value: unknown): value is SalesCustomer {
  if (!value || typeof value !== "object") return false;
  const customer = value as Record<string, unknown>;
  return ["id", "name", "code"].every(key => typeof customer[key] === "string") && Boolean(customer.id);
}

/** Every picker read rechecks the same signed-in permission/scope context as the enquiry. */
export async function readEnquiryCustomers(params: URLSearchParams, context: string, request: typeof fetch = fetch) {
  const response = await request(`/api/sales?${params}`, { cache: "no-store" });
  if ([401, 403].includes(response.status)) throw new CustomerAccessChanged();
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Customers could not be checked. Try the read again; do not repeat a customer save.");
  if (body.recoveryContext !== context || !body.canEdit || !body.canCreate) throw new CustomerAccessChanged();
  if (params.has("customerId")) {
    if (!isCustomer(body.customer) || body.customer.id !== params.get("customerId")) throw new Error("The saved customer could not be verified. Do not create it again.");
    return { customers: [body.customer], nextCursor: null };
  }
  if (!Array.isArray(body.customers) || !body.customers.every(isCustomer) ||
      (body.nextCursor !== null && typeof body.nextCursor !== "string")) throw new Error("The customer list could not be verified. Search again.");
  return { customers: body.customers as SalesCustomer[], nextCursor: body.nextCursor as string | null };
}

export function mergeCustomers(current: SalesCustomer[], incoming: SalesCustomer[]) {
  return [...new Map([...current, ...incoming].map(customer => [customer.id, customer])).values()];
}
