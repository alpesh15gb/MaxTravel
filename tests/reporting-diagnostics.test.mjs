import assert from "node:assert/strict";
import test from "node:test";
import { createReportDiagnostics } from "./reporting-diagnostics.mjs";
test("report diagnostics retain timing/status but never identifiers, secret bodies or headers", () => {
 let time = 100;const diagnostic = createReportDiagnostics(() => time);
 const request = { url: () => "https://local.test/api/reports/accounts?report=ageing&from=2026-10-24&to=2026-10-24&customerId=PRIVATE_CUSTOMER&ownerId=PRIVATE_OWNER&status=PRIVATE_STAGE", method: () => "GET", postData: () => "PRIVATE_BODY", headers: () => ({ cookie: "PRIVATE_COOKIE" }), failure: () => ({ errorText: "net::ERR_ABORTED" }) };
 diagnostic.request(request);time += 3;diagnostic.response({ request: () => request, status: () => 200 });time += 7;diagnostic.finished(request);diagnostic.mark("terms-refresh-finished");
 const snapshot = diagnostic.snapshot();assert.equal(snapshot.requests[0].finishedMs,10);assert.equal(snapshot.requests[0].state,"finished");assert.equal(snapshot.requests[0].status,200);assert.deepEqual(snapshot.requests[0].filters,["customerId","ownerId","status"]);assert(!JSON.stringify(snapshot).includes("PRIVATE"));
});
test("request failures and still-pending reads remain distinct", () => {
 const diagnostic = createReportDiagnostics();const req = () => ({ url: () => "https://local.test/api/reports/terms", method: () => "POST", failure: () => ({ errorText: "net::ERR_FAILED" }) });const first = req(),second = req();diagnostic.request(first);diagnostic.request(second);diagnostic.failed(first);assert.deepEqual(diagnostic.snapshot().requests.map(row => row.state),["failed","pending"]);
});
