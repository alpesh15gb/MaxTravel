// Read-only exhaustive SQLite integrity/schema/table-count/sequence/migration audit.
// Runs via explicit node entrypoint; never imports app/workers or calls providers.
const fs=require('node:fs'),crypto=require('node:crypto');
const {PrismaClient}=require('/app/node_modules/@prisma/client');
const p=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
const quote=s=>'"'+s.replaceAll('"','""')+'"';
(async()=>{try {
 await p.$executeRawUnsafe('PRAGMA query_only = ON');
 const integrity=await p.$queryRawUnsafe('PRAGMA integrity_check');
 if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw Error('integrity');
 if((await p.$queryRawUnsafe('PRAGMA foreign_key_check')).length)throw Error('foreign keys');
 const schema=await p.$queryRawUnsafe("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
 const counts={};for(const row of schema.filter(r=>r.type==='table')) {
  const result=await p.$queryRawUnsafe('SELECT COUNT(*) AS n FROM '+quote(row.name));counts[row.name]=String(result[0].n);
 }
 const hasSeq=await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'");
 const sequences=hasSeq.length?await p.$queryRawUnsafe('SELECT name,seq FROM sqlite_sequence ORDER BY name'):[];
 const ledger=await p.$queryRawUnsafe('SELECT * FROM _prisma_migrations ORDER BY id');
 const migrations=fs.readdirSync('/app/prisma/migrations',{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
 for(const name of migrations) {
  const digest=crypto.createHash('sha256').update(fs.readFileSync('/app/prisma/migrations/'+name+'/migration.sql')).digest('hex');
  const rows=ledger.filter(r=>r.migration_name===name && r.rolled_back_at===null);
  if(rows.length!==1||!rows[0].finished_at||rows[0].checksum!==digest)throw Error('pending or mismatched migration');
 }
 if(ledger.some(r=>!r.rolled_back_at && (!r.finished_at||!migrations.includes(r.migration_name))))throw Error('unrecognized live migration');
 console.log(JSON.stringify({schema,counts,sequences,ledger},(_,v)=>typeof v==='bigint'?v.toString():v));
 } finally {await p.$disconnect();}
})().catch(()=>{console.error('SQLite audit failed; inspect private evidence. No row contents printed.');process.exitCode=1;});
