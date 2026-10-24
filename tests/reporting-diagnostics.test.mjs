import assert from "node:assert/strict";
import test from "node:test";
import { createReportDiagnostics, probeReportServer } from "./reporting-diagnostics.mjs";
test("report diagnostics retain timing/status but never identifiers, secret bodies or headers", () => {
 let time = 100;const diagnostic = createReportDiagnostics(() => time);
 const request = { url: () => "https://local.test/api/reports/accounts?report=ageing&from=2026-10-24&to=2026-10-24&customerId=PRIVATE_CUSTOMER&ownerId=PRIVATE_OWNER&status=PRIVATE_STAGE", method: () => "GET", postData: () => "PRIVATE_BODY", headers: () => ({ cookie: "PRIVATE_COOKIE" }), failure: () => ({ errorText: "net::ERR_ABORTED" }) };
 diagnostic.request(request);time += 3;diagnostic.response({ request: () => request, status: () => 200 });time += 7;diagnostic.finished(request);diagnostic.mark("terms-refresh-finished");
 const snapshot = diagnostic.snapshot();assert.equal(snapshot.requests[0].finishedMs,10);assert.equal(snapshot.requests[0].state,"finished");assert.equal(snapshot.requests[0].status,200);assert.deepEqual(snapshot.requests[0].filters,["customerId","ownerId","status"]);assert(!JSON.stringify(snapshot).includes("PRIVATE"));
});
test("request failures and still-pending reads remain distinct", () => {
 const diagnostic = createReportDiagnostics();const req = () => ({ url: () => "https://local.test/api/reports/terms", method: () => "POST", failure: () => ({ errorText: "net::ERR_FAILED" }) });const first = req(),second = req();diagnostic.request(first);diagnostic.request(second);diagnostic.failed(first);assert.deepEqual(diagnostic.snapshot().requests.map(row => row.state),["failed","pending"]);
});

test("failure-only server probe is a bounded GET and records no URL, body or identity", async () => {
 let time=20;const url="http://127.0.0.1:3000/api/reports/accounts?report=ageing&customerId=PRIVATE_CUSTOMER";
 const result=await probeReportServer({get:async(actual,options)=>{assert.equal(actual,url);assert.deepEqual(options,{timeout:5000,maxRedirects:0,maxRetries:0});time=32;return{status:()=>200,json:()=>{throw Error("Body must not be read");}};}},url,()=>time);
 assert.deepEqual(result,{status:200,durationMs:12});assert(!JSON.stringify(result).includes("PRIVATE"));
});
test("server probe failure remains diagnostic rather than replacing the original assertion", async () => {
 const result=await probeReportServer({get:async()=>{const error=new Error("PRIVATE_URL_BODY");error.name="TimeoutError";throw error;}},"http://127.0.0.1:3000/api/reports/accounts",()=>10);
 assert.deepEqual(result,{error:"TimeoutError",durationMs:0});
});
