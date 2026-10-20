// Disposable fixtures only; never points at deployed data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir(path.join(root, 'tests/.runtime'), {recursive:true});
const temp = await fs.mkdtemp(path.join(root, 'tests/.runtime/backup-regression-'));
const database = path.join(temp, 'fixture.db'), uploads = path.join(temp, 'uploads');
const env = {...process.env, DATABASE_URL:`file:${database}`, UPLOAD_ROOT:uploads};
const run = (args) => execFileSync(process.execPath, args, {cwd:root, env, encoding:'utf8', stdio:'pipe'});
let db;
try {
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  db = new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  await fs.mkdir(uploads); await fs.writeFile(path.join(uploads, 'document.txt'), 'snapshot document');
  await fs.symlink(database, path.join(uploads, 'external-link'));
  // Interpose only in this test subprocess: staff write after VACUUM, at upload copy.
  const hook = path.join(temp, 'concurrent-write.mjs');
  await fs.writeFile(hook, `import fs from 'node:fs/promises';\nimport {PrismaClient} from '@prisma/client';\nconst read=fs.readFile;fs.readFile=async (file,...args)=>{if(String(file)===process.cwd()+'/.env'||String(file)===process.cwd()+'/.env.local')throw Object.assign(new Error('isolated fixture'),{code:'ENOENT'});return read(file,...args);};const original=fs.cp; fs.cp=async (...args)=>{const db=new PrismaClient();try{await db.supplier.create({data:{name:'Concurrent supplier',type:'OTHER'}});}finally{await db.$disconnect();}await fs.writeFile(args[0]+'/document.txt','changed live document');await original(...args);};`);
  run(['--import', hook, 'scripts/backup.mjs', '--out', path.join(temp,'backups')]);
  const backup = path.join(temp,'backups',(await fs.readdir(path.join(temp,'backups')))[0]);
  const manifest = JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
  assert.equal(await db.supplier.count(),1);
  assert.equal(manifest.rowCounts.Supplier,0,'Manifest must count snapshot, not concurrent live write');
  assert.equal(manifest.uploads.fileCount,1,'Symlinks must not enter backup');
  await assert.rejects(fs.lstat(path.join(backup,'uploads/external-link')));
  const target = path.join(temp,'restore');
  assert.match(run(['scripts/restore.mjs','--in',backup,'--out',target]),/Restore verified/);
  const before = await fs.readFile(path.join(target,'fixture.db'));
  for(const suffix of ['-wal','-shm','-journal']) {
    await fs.writeFile(path.join(target,'fixture.db'+suffix),'fixture recovery file');
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('SQLite recovery files'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before,'Rejected restore must preserve target');
    await fs.rm(path.join(target,'fixture.db'+suffix));
  }
  const source = path.join(backup,'database/fixture.db');
  const corrupt=await fs.readFile(source); corrupt[100]^=1; await fs.writeFile(source,corrupt);
  assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('checksum'));
  assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before,'Damaged backup must not overwrite target');
  console.log('PASS backup snapshot counts, copied upload hashes, symlink exclusion, verified restore, sidecar rejection, corrupt-source preservation.');
} finally { await db?.$disconnect(); await fs.rm(temp,{recursive:true,force:true}); }
