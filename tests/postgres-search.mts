import assert from 'node:assert/strict';
import {prisma} from '../src/lib/db';
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith('/maxtravel_crm_preview'),'Preview database required');
try{
 const record=await prisma.serviceCase.findFirstOrThrow();const q=record.caseNo.toLowerCase();
 assert((await prisma.serviceCase.findMany({where:{caseNo:{contains:q}}})).some(r=>r.id===record.id));
 assert(!(await prisma.serviceCase.findMany({where:{caseNo:{not:{contains:q}}}})).some(r=>r.id===record.id));
 assert.equal(await prisma.serviceCase.count({where:{caseNo:{equals:q}}}),0);
 console.log('Actual PostgreSQL: lowercase case search matches, nested exclusion excludes and exact identifiers remain case-sensitive.');
}finally{await prisma.$disconnect();}
