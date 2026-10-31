import assert from 'node:assert/strict';
import {normalizeTextSearch} from '../src/lib/search-parity';
const date=new Date();const input={AND:[{caseNo:{contains:'case-2026'}},{title:{not:{contains:'visa'}}},{ownerId:{equals:'CaseSensitiveID'}},{createdAt:{gte:date}}]};
assert.deepEqual(normalizeTextSearch(input),{AND:[{caseNo:{contains:'case-2026',mode:'insensitive'}},{title:{not:{contains:'visa'},mode:'insensitive'}},{ownerId:{equals:'CaseSensitiveID'}},{createdAt:{gte:date}}]});
assert(!('mode'in input.AND[0].caseNo!));assert.equal((normalizeTextSearch({createdAt:{gte:date}})as {createdAt:{gte:Date}}).createdAt.gte,date);
assert.deepEqual(normalizeTextSearch({title:{contains:'A',mode:'default'}}),{title:{contains:'A',mode:'default'}});
console.log('Search parity: patterns, nested negation, exact identifiers, dates and caller inputs preserved.');
