import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {base32,decode32,totp,totpStep,seal,unseal,hashToken} from "../src/lib/staff-security";
const secret=base32(Buffer.from("12345678901234567890"));
assert.equal(decode32(secret).toString(),"12345678901234567890");
// RFC 6238 SHA-1 vectors reduced to six digits.
for(const [seconds,expected] of [[59,"287082"],[1111111109,"081804"],[1111111111,"050471"],[1234567890,"005924"],[2000000000,"279037"],[20000000000,"353130"]] as const)assert.equal(totp(secret,Math.floor(seconds/30)),expected);
assert.equal(totpStep(secret,"287082",-1,59000),1);
assert.equal(totpStep(secret,"287082",1,59000),null);
assert.equal(totpStep(secret,"12345",-1,59000),null);
process.env.CRM_DATA_ENCRYPTION_KEY=randomBytes(32).toString("hex");
const encrypted=seal(secret,"test-user");assert(!encrypted.includes(secret));assert.equal(unseal(encrypted,"test-user"),secret);assert.throws(()=>unseal(encrypted,"another-user"));
assert.notEqual(hashToken("ABC"),hashToken("ABD"));delete process.env.CRM_DATA_ENCRYPTION_KEY;assert.throws(()=>seal(secret,"test"));
console.log("Staff security: RFC vectors, replay boundary, encrypted context and missing-key checks passed.");
