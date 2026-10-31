// A separate acceptance test; the artifact inspection remains read-only and offline.
// Only an empty, disposable tmpfs database is migrated. No host data is mounted.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const name='crm-isolated-boot-'+randomBytes(6).toString('hex');
const env={...process.env,JWT_SECRET:randomBytes(32).toString('hex'),CRM_DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
const docker=(args,timeout=15000)=>execFileSync('docker',args,{env,encoding:'utf8',timeout,windowsHide:true,stdio:['ignore','pipe','pipe']});
const expected=fs.readdirSync('prisma/migrations').filter(p=>fs.existsSync(path.join('prisma/migrations',p,'migration.sql'))).sort();
async function main(){
 try{
  docker(['run','--detach','--name',name,'--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--no-healthcheck','--tmpfs','/data:rw,nosuid,nodev,mode=1777,size=128m','--tmpfs','/tmp:rw,nosuid,nodev,mode=1777,size=128m','--env','JWT_SECRET','--env','CRM_DATA_ENCRYPTION_KEY','--env','DATABASE_URL=file:/data/app.db','--env','APP_ORIGIN=http://127.0.0.1:3000','--env','RUN_MIGRATIONS=true','crm-production-smoke']);
  const until=Date.now()+90000;let healthy=false;
  while(Date.now()<until){
   assert.equal(docker(['inspect','--format','{{.State.Running}}',name]).trim(),'true','The isolated app exited before readiness');
   try{docker(['exec',name,'node','-e',"fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(async r=>{const b=await r.json();if(!r.ok||b.status!=='ok'||b.checks.database!=='ok'||b.checks.schema!=='ok')process.exitCode=1}).catch(()=>process.exitCode=1)"],7000);healthy=true;break;}catch{}
   await new Promise(r=>setTimeout(r,750));
  }
  assert(healthy,'The isolated app did not become database/schema healthy');
  const inspect="const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');const db=new PrismaClient();(async()=>{const rows=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL');assert.deepEqual(rows.map(r=>r.migration_name).sort(),"+JSON.stringify(expected)+");assert.equal(await db.user.count(),0);console.log('Fresh SQLite migrations and authenticated workspace prerequisites are structurally ready.');})().catch(()=>{console.error('Migration receipt check failed');process.exitCode=1}).finally(()=>db.$disconnect());";
  process.stdout.write(docker(['exec',name,'node','-e',inspect]));
  console.log('Isolated Linux image boot and health check passed.');
 }catch(error){
  try{process.stderr.write(docker(['logs','--tail','80',name]));}catch{}
  console.error(error instanceof Error?error.message:'Isolated image boot failed');process.exitCode=1;
 }finally{try{docker(['rm','--force','--volumes',name]);}catch{}}
}
main();
