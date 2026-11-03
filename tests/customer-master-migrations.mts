import assert from 'node:assert/strict';
import {mkdtemp,realpath,cp,mkdir,writeFile,readdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';import {PrismaClient} from '@prisma/client';
const parent=await realpath(tmpdir()),dir=await mkdtemp(path.join(parent,'crm-master-upgrade-')),schema=path.join(dir,'prisma/schema.prisma'),url='file:'+path.join(dir,'upgrade.db').replaceAll('\\','/'),migration='20261102100000_customer_masters';
const env={...process.env,DATABASE_URL:url},cli=path.resolve('node_modules/prisma/build/index.js');let db=new PrismaClient({datasources:{db:{url}}});
try{
 await mkdir(path.join(dir,'prisma/migrations'),{recursive:true});await cp('prisma/schema.prisma',schema);await writeFile(path.join(dir,'upgrade.db'),'');
 for(const file of await readdir('prisma/migrations'))if(file!==migration)await cp(path.join('prisma/migrations',file),path.join(dir,'prisma/migrations',file),{recursive:true});
 execFileSync(process.execPath,[cli,'migrate','deploy','--schema',schema],{env,stdio:'pipe'});
 await db.$executeRawUnsafe(`INSERT INTO "Branch" (id,code,name,city) VALUES ('b','B','Upgrade branch','Test')`);
 await db.$executeRawUnsafe(`INSERT INTO "Customer" (id,code,name,phone,city,branchId) VALUES ('c','C-LEGACY','Legacy customer','+919000000001','Test','b')`);
 await db.$executeRawUnsafe(`INSERT INTO "Traveller" (id,customerId,fullName,passportNumber,frequentFlyer,knownTravellerNumber) VALUES ('t','c','Legacy traveller','SYNTHETIC-PASSPORT','SYNTHETIC-OLD-FF','SYNTHETIC-KTN')`);
 const originalSchema=await readFile('prisma/schema.prisma','utf8'),baselineSchema=path.join(dir,'baseline.prisma');
 const priorSchema=originalSchema.replace(/model (TravellerLoyaltyMembership|TravellerIdentityDocument|MasterMutation) \{[\s\S]*?\n\}/g,'').replace(/^\s*(profileData|masterMutations|loyaltyMemberships|identityDocuments|identityRecords)\s+.*$/gm,'');await writeFile(baselineSchema,priorSchema);
 const diff=(target)=>{const result=spawnSync(process.execPath,[cli,'migrate','diff','--from-url',url,'--to-schema-datamodel',target,'--exit-code'],{env,encoding:'utf8'});assert([0,2].includes(result.status),result.stderr);return result.stdout;};const previousDrift=diff(baselineSchema);
 const before=await db.$queryRawUnsafe('SELECT id,fullName,passportNumber,frequentFlyer,knownTravellerNumber FROM "Traveller"');await db.$disconnect();
 await cp(path.join('prisma/migrations',migration),path.join(dir,'prisma/migrations',migration),{recursive:true});execFileSync(process.execPath,[cli,'migrate','deploy','--schema',schema],{env,stdio:'pipe'});
 db=new PrismaClient({datasources:{db:{url}}});assert.deepEqual(await db.$queryRawUnsafe('SELECT id,fullName,passportNumber,frequentFlyer,knownTravellerNumber FROM "Traveller"'),before);assert.equal((await db.customer.findUniqueOrThrow({where:{id:'c'}})).profileData,null);assert.equal(await db.travellerLoyaltyMembership.count(),0);assert.equal(await db.travellerIdentityDocument.count(),0);
 const drift=diff('prisma/schema.prisma');assert.equal(drift,previousDrift,'Master migration must introduce no schema drift; unrelated baseline differences stay unchanged');
 const sqlite=await readFile('prisma/schema.prisma','utf8'),postgres=await readFile('prisma/postgresql/schema.prisma','utf8');for(const model of ['TravellerLoyaltyMembership','TravellerIdentityDocument','MasterMutation']){const block=s=>s.replaceAll('\r\n','\n').match(new RegExp('model '+model+' \\{[\\s\\S]*?\\n\\}'))?.[0].replace(/\s+@db\.Timestamptz\(3\)/g,'');assert.equal(block(sqlite),block(postgres));}
 execFileSync(process.execPath,[cli,'validate','--schema','prisma/postgresql/schema.prisma'],{env:{...env,DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:1/fixture'},stdio:'pipe'});
 console.log('PASS customer-master migration: real previous-schema upgrade preserves legacy profiles; no new SQLite drift; PostgreSQL model parity and schema validation.');
}finally{await db.$disconnect();const actual=await realpath(dir);assert.equal(path.dirname(actual),parent);assert(path.basename(actual).startsWith('crm-master-upgrade-'));await rm(actual,{recursive:true,force:true});}
