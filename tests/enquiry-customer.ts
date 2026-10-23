import assert from "node:assert/strict";
import { createEnquiryCustomer, readEnquiryCustomers, mergeCustomers, CustomerAccessChanged, type CustomerFields } from "../src/app/(app)/sales/enquiry-customer";

async function main() {
  const fields: CustomerFields = { name: "Synthetic customer", phone: "9000000101", email: "", city: "", type: "INDIVIDUAL" };
  const customer = { id: "customer-1", name: fields.name, code: "C-001" };
  const context = { recoveryContext: "fixture-context", canEdit: true, canCreate: true };
  const writeContext = "a".repeat(64);
  let requests = 0;
  const respond = (body: unknown, status = 200) => (async () => { requests++; return Response.json(body, { status }); }) as typeof fetch;
  assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({ id: customer.id })), { kind: "created", id: customer.id });
  for (const status of [400, 409, 422, 429]) assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({ error: "Rejected fixture" }, status)), { kind: "rejected", message: "Rejected fixture" });
  for (const status of [401, 403]) assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({ error: "Denied" }, status)), { kind: "access-changed" });
  for (const status of [500, 502, 503]) assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({}, status)), { kind: "uncertain" });
  assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({ ok: true })), { kind: "uncertain" });
  assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({ id: "" })), { kind: "uncertain" });
  const thrown = (async () => { requests++; throw new TypeError("Synthetic dropped response"); }) as typeof fetch;
  const before = requests;
  assert.deepEqual(await createEnquiryCustomer(fields, writeContext, thrown), { kind: "uncertain" });
  assert.equal(requests - before, 1, "Unknown saves are not retried automatically");
  assert.deepEqual(await createEnquiryCustomer(fields, writeContext, (async () => new Response("not json", { status: 200 })) as typeof fetch), { kind: "uncertain" });

  assert.deepEqual(await createEnquiryCustomer(fields, writeContext, respond({ code: "SALES_CONTEXT_CHANGED" }, 409)), { kind: "access-changed" });
  const missingBefore = requests;
  assert.deepEqual(await createEnquiryCustomer(fields, "", respond({ id: customer.id })), { kind: "access-changed" });
  assert.equal(requests, missingBefore, "Inline creation cannot send an unbound write");
  await createEnquiryCustomer(fields, writeContext, (async (_url, options) => {
    assert.equal(new Headers(options?.headers).get("x-sales-recovery-context"), writeContext);
    return Response.json({ id: customer.id });
  }) as typeof fetch);
  const specific = new URLSearchParams({ customerId: customer.id });
  assert.deepEqual(await readEnquiryCustomers(specific, context.recoveryContext, respond({ ...context, customer })), { customers: [customer], nextCursor: null });
  for (const status of [401, 403]) await assert.rejects(readEnquiryCustomers(specific, context.recoveryContext, respond({}, status)), CustomerAccessChanged);
  await assert.rejects(readEnquiryCustomers(specific, context.recoveryContext, respond({ ...context, customer, recoveryContext: "other-staff-or-scope" })), CustomerAccessChanged);
  for (const permission of ["canCreate", "canEdit"]) await assert.rejects(readEnquiryCustomers(specific, context.recoveryContext, respond({ ...context, customer, [permission]: false })), CustomerAccessChanged);
  await assert.rejects(readEnquiryCustomers(specific, context.recoveryContext, respond({ ...context, customer: { ...customer, id: "other" } })), /could not be verified/);
  await assert.rejects(readEnquiryCustomers(specific, context.recoveryContext, respond({ error: "Customer not found" }, 404)), /Customer not found/);
  const query = new URLSearchParams({ customers: "1", q: "test", cursor: "after-1" });
  const list = await readEnquiryCustomers(query, context.recoveryContext, (async (url, options) => {
    assert.equal(url, "/api/sales?customers=1&q=test&cursor=after-1");
    assert.equal(options?.cache, "no-store"); assert.equal(options?.method, undefined, "Read-only checks never retry creation");
    return Response.json({ ...context, customers: [customer], nextCursor: "after-2" });
  }) as typeof fetch);
  assert.deepEqual(list, { customers: [customer], nextCursor: "after-2" });
  await assert.rejects(readEnquiryCustomers(query, context.recoveryContext, respond({ ...context, customers: [{ id: customer.id }], nextCursor: null })), /could not be verified/);
  assert.deepEqual(mergeCustomers([customer], [{ ...customer, name: "Latest permitted name" }, { ...customer, id: "second" }]), [{ ...customer, name: "Latest permitted name" }, { ...customer, id: "second" }]);
  console.log("Enquiry customer tests passed: scoped read validation, permission boundaries, safe error outcomes, no duplicate retry, deduplicated paging.");
}
void main();
