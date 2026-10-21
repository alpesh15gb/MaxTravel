// Disposable fixtures only; never points at deployed data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir(path.join(root, 'tests/.runtime'), {recursive:true});
const temp = await fs.mkdtemp(path.join(root, 'tests/.runtime/backup-regression-'));
const database = path.join(temp, 'fixture.db'), uploads = path.join(temp, 'uploads');
const media = path.join(temp, 'package-media');
const env = {...process.env, PACKAGE_MEDIA_ROOT:"", DATABASE_URL:`file:${database}`, UPLOAD_ROOT:uploads};
const run = (args) => execFileSync(process.execPath, args, {cwd:root, env, encoding:'utf8', stdio:'pipe'});
let db;
try {
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  db = new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  await fs.mkdir(uploads); await fs.writeFile(path.join(uploads, 'document.txt'), 'snapshot document');
  await fs.symlink(database, path.join(uploads, 'external-link'));
  await fs.mkdir(media); await fs.writeFile(path.join(media, 'fixture.webp'), 'immutable media fixture');
  await fs.symlink(database, path.join(media, 'external-link'));
  const pkg=await db.travelPackage.create({data:{slug:'backup-fixture',title:'Backup fixture',draftJson:'{}'}});
  await db.packageMedia.create({data:{id:'00000000-0000-4000-8000-000000000001',packageId:pkg.id,storageName:'fixture.webp',mimeType:'image/webp',byteSize:Buffer.byteLength('immutable media fixture'),width:1,height:1,sha256:createHash('sha256').update('immutable media fixture').digest('hex')}});

  // Interpose only in this test subprocess: staff write after VACUUM, at upload copy.
  const hook = path.join(temp, 'concurrent-write.mjs');
  await fs.writeFile(hook, `import fs from 'node:fs/promises';\nimport {PrismaClient} from '@prisma/client';\nconst read=fs.readFile;fs.readFile=async (file,...args)=>{if(String(file)===process.cwd()+'/.env'||String(file)===process.cwd()+'/.env.local')throw Object.assign(new Error('isolated fixture'),{code:'ENOENT'});return read(file,...args);};const original=fs.cp; fs.cp=async (...args)=>{if(args[0]!==process.env.UPLOAD_ROOT)return original(...args);const db=new PrismaClient();try{await db.supplier.upsert({where:{name:'Concurrent supplier'},create:{name:'Concurrent supplier',type:'OTHER'},update:{}});}finally{await db.$disconnect();}await fs.writeFile(args[0]+'/document.txt','changed live document');await original(...args);};`);
  run(['--import', hook, 'scripts/backup.mjs', '--out', path.join(temp,'backups')]);
  const backup = path.join(temp,'backups',(await fs.readdir(path.join(temp,'backups')))[0]);
  const manifest = JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
  assert.equal(await db.supplier.count(),1);
  assert.equal(manifest.rowCounts.Supplier,0,'Manifest must count snapshot, not concurrent live write');
  assert.equal(manifest.uploads.fileCount,1,'Symlinks must not enter backup');
  assert.equal(manifest.formatVersion,2);
  assert.equal(manifest.packageMedia.fileCount,1);
  assert.equal(manifest.rowCounts.PackageMedia,1);
  await assert.rejects(fs.lstat(path.join(backup,'package-media/external-link')));
  await assert.rejects(fs.lstat(path.join(backup,'uploads/external-link')));
  const target = path.join(temp,'restore');
  assert.match(run(['scripts/restore.mjs','--in',backup,'--out',target]),/Restore verified/);
  assert.equal(await fs.readFile(path.join(target,'package-media/fixture.webp'),'utf8'),'immutable media fixture');
  // A genuine pre-media v1 DB remains compatible; relabelling a media DB is not legacy.
  const legacyTarget=path.join(temp,'legacy-restore');
  await fs.mkdir(path.join(legacyTarget,'package-media'),{recursive:true});
  await fs.writeFile(path.join(legacyTarget,'package-media/keep.webp'),'legacy sentinel');
  const legacy={...manifest,formatVersion:1,rowCounts:{...manifest.rowCounts}}; delete legacy.packageMedia; delete legacy.rowCounts.PackageMedia;
  const legacyBackup=path.join(temp,'legacy-backup'); await fs.cp(backup,legacyBackup,{recursive:true});
  const legacyDbFile=path.join(legacyBackup,'database/fixture.db');
  const legacyDb=new PrismaClient({datasources:{db:{url:`file:${legacyDbFile}`}}});
  try { await legacyDb.$executeRawUnsafe('DROP TABLE "PackageMedia"'); await legacyDb.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name = \'20261021224000_package_media\''); } finally { await legacyDb.$disconnect(); }
  legacy.rowCounts.TravelPackage=null; legacy.rowCountErrors={TravelPackage:'Historical unavailable count'};
  const legacyBytes=await fs.readFile(legacyDbFile); legacy.database={...legacy.database,bytes:legacyBytes.length,sha256:createHash('sha256').update(legacyBytes).digest('hex')};
  await fs.rm(path.join(legacyBackup,'package-media'),{recursive:true});
  await fs.writeFile(path.join(legacyBackup,'manifest.json'),JSON.stringify(legacy));
  const legacyResult=run(['scripts/restore.mjs','--in',legacyBackup,'--out',legacyTarget]); assert.match(legacyResult,/Restore verified/); assert.match(legacyResult,/TravelPackage row count was unavailable.*not verified/);
  assert.equal(await fs.readFile(path.join(legacyTarget,'package-media/keep.webp'),'utf8'),'legacy sentinel');
  // Make destination distinct so a premature replacement cannot pass preservation checks.
  await fs.appendFile(path.join(target,'fixture.db'),'destination sentinel');
  await fs.writeFile(path.join(target,'uploads/target-only.txt'),'preserve this file');
  const before = await fs.readFile(path.join(target,'fixture.db'));
  const originalUpload = await fs.readFile(path.join(backup,'uploads/document.txt'));
  const sourceDb=path.join(backup,'database/fixture.db'), originalDb=await fs.readFile(sourceDb);
  async function sourceRejectsWithoutMutation(badManifest) {
    await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify(badManifest));
    const sourceBefore=await fs.readFile(sourceDb), sourceNamesBefore=await fs.readdir(path.dirname(sourceDb));
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('target was not modified'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before);
    assert.equal(await fs.readFile(path.join(target,'uploads/target-only.txt'),'utf8'),'preserve this file');
    assert.equal(await fs.readFile(path.join(target,'package-media/fixture.webp'),'utf8'),'immutable media fixture');
    const fresh=path.join(temp,'preflight-must-not-exist');
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',fresh]),e=>String(e.stderr).includes('target was not modified'));
    await assert.rejects(fs.lstat(fresh),{code:'ENOENT'});
    assert.deepEqual(await fs.readFile(sourceDb),sourceBefore,'Preflight cannot change source DB');
    assert.deepEqual(await fs.readdir(path.dirname(sourceDb)),sourceNamesBefore,'Preflight cannot create source sidecars');
    await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest));
  }
  for(const label of ['Supplier','PackageMedia']) {
    const wrong=structuredClone(manifest); wrong.rowCounts[label]++;
    await sourceRejectsWithoutMutation(wrong);
    wrong.rowCounts[label]='not-a-count'; await sourceRejectsWithoutMutation(wrong);
  }
  const downgraded=structuredClone(manifest); downgraded.formatVersion=1; delete downgraded.packageMedia; delete downgraded.rowCounts.PackageMedia;
  await sourceRejectsWithoutMutation(downgraded);
  for(const change of [{sha256:'0'.repeat(64)},{byteSize:999},{storageName:'missing.webp'}]) {
    const sourceClient=new PrismaClient({datasources:{db:{url:`file:${sourceDb}`}}});
    try { await sourceClient.packageMedia.updateMany({data:change}); } finally { await sourceClient.$disconnect(); }
    const changedBytes=await fs.readFile(sourceDb), changedManifest=structuredClone(manifest);
    changedManifest.database.bytes=changedBytes.length; changedManifest.database.sha256=createHash('sha256').update(changedBytes).digest('hex');
    await sourceRejectsWithoutMutation(changedManifest);
    await fs.writeFile(sourceDb,originalDb);
  }
  await fs.writeFile(sourceDb+'-journal','source recovery sentinel');
  await sourceRejectsWithoutMutation(manifest); await fs.unlink(sourceDb+'-journal');

  for (const damage of ['changed','missing','extra','symlink','missing-directory']) {
    const sourceUploads=path.join(backup,'uploads');
    if(damage==='changed')await fs.writeFile(path.join(sourceUploads,'document.txt'),Buffer.alloc(originalUpload.length,65));
    if(damage==='missing')await fs.rm(path.join(sourceUploads,'document.txt'));
    if(damage==='extra')await fs.writeFile(path.join(sourceUploads,'unexpected.txt'),'extra');
    if(damage==='symlink')await fs.symlink(database,path.join(sourceUploads,'unsafe-link'));
    if(damage==='missing-directory')await fs.rename(sourceUploads,sourceUploads+'-hidden');
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('target was not modified'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before,'Damaged uploads must preserve destination database');
    assert.deepEqual(await fs.readFile(path.join(target,'uploads/document.txt')),originalUpload);
    assert.equal(await fs.readFile(path.join(target,'uploads/target-only.txt'),'utf8'),'preserve this file');
    if(damage==='missing-directory')await fs.rename(sourceUploads+'-hidden',sourceUploads);
    await fs.writeFile(path.join(sourceUploads,'document.txt'),originalUpload);
    await fs.rm(path.join(sourceUploads,'unexpected.txt'),{force:true});
    await fs.rm(path.join(sourceUploads,'unsafe-link'),{force:true});
  }
  const sourceMedia=path.join(backup,'package-media');
  const originalMedia=await fs.readFile(path.join(sourceMedia,'fixture.webp'));
  await fs.writeFile(path.join(target,'package-media/target-only.webp'),'preserve media');
  for (const damage of ['changed','missing','extra','symlink','missing-directory','root-symlink']) {
    if(damage==='changed')await fs.writeFile(path.join(sourceMedia,'fixture.webp'),Buffer.alloc(originalMedia.length,65));
    if(damage==='missing')await fs.rm(path.join(sourceMedia,'fixture.webp'));
    if(damage==='extra')await fs.writeFile(path.join(sourceMedia,'unexpected.webp'),'extra');
    if(damage==='symlink')await fs.symlink(database,path.join(sourceMedia,'unsafe-link'));
    if(damage==='missing-directory'||damage==='root-symlink')await fs.rename(sourceMedia,sourceMedia+'-hidden');
    if(damage==='root-symlink')await fs.symlink(sourceMedia+'-hidden',sourceMedia);
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('target was not modified'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before);
    assert.deepEqual(await fs.readFile(path.join(target,'uploads/document.txt')),originalUpload);
    assert.equal(await fs.readFile(path.join(target,'uploads/target-only.txt'),'utf8'),'preserve this file');
    assert.deepEqual(await fs.readFile(path.join(target,'package-media/fixture.webp')),originalMedia);
    assert.equal(await fs.readFile(path.join(target,'package-media/target-only.webp'),'utf8'),'preserve media');
    if(damage==='root-symlink')await fs.unlink(sourceMedia);
    if(damage==='missing-directory'||damage==='root-symlink')await fs.rename(sourceMedia+'-hidden',sourceMedia);
    await fs.writeFile(path.join(sourceMedia,'fixture.webp'),originalMedia);
    await fs.rm(path.join(sourceMedia,'unexpected.webp'),{force:true});
    await fs.rm(path.join(sourceMedia,'unsafe-link'),{force:true});
  }
  for(const suffix of ['-wal','-shm','-journal']) {
    await fs.writeFile(path.join(target,'fixture.db'+suffix),'fixture recovery file');
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('SQLite recovery files'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before,'Rejected restore must preserve target');
    await fs.rm(path.join(target,'fixture.db'+suffix));
  }
  // Root and destination links must not redirect restore writes outside its target.
  const outside=path.join(temp,'outside'); await fs.mkdir(outside);
  const sentinel=path.join(outside,'sentinel.db'); await fs.writeFile(sentinel,'outside sentinel');
  for(const relative of ['database','uploads']) {
    const sourcePath=path.join(backup,relative);
    await fs.rename(sourcePath,sourcePath+'-real'); await fs.symlink(sourcePath+'-real',sourcePath);
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('target was not modified'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before);
    assert.equal(await fs.readFile(sentinel,'utf8'),'outside sentinel');
    const fresh=path.join(temp,'must-not-be-created-'+relative);
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',fresh]),e=>String(e.stderr).includes('target was not modified'));
    await assert.rejects(fs.lstat(fresh),{code:'ENOENT'});
    await fs.unlink(sourcePath); await fs.rename(sourcePath+'-real',sourcePath);
  }
  const linkedTarget=path.join(temp,'linked-target'); await fs.symlink(outside,linkedTarget);
  assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',linkedTarget,'--force']),e=>String(e.stderr).includes('target was not modified'));
  assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',path.join(linkedTarget,'nested'),'--force']),e=>String(e.stderr).includes('target was not modified'));
  assert.deepEqual(await fs.readdir(outside),['sentinel.db']);
  const dbTarget=path.join(temp,'linked-db-target'); await fs.mkdir(dbTarget);
  await fs.symlink(sentinel,path.join(dbTarget,'fixture.db'));
  assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',dbTarget,'--force']),e=>String(e.stderr).includes('target was not modified'));
  assert.equal(await fs.readFile(sentinel,'utf8'),'outside sentinel');
  assert.deepEqual(await fs.readdir(dbTarget),['fixture.db']);
  for(const tree of ['uploads','packageMedia']) {
    const malformed=structuredClone(manifest); malformed[tree].files[0].bytes++;
    await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify(malformed));
    assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('target was not modified'));
    assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before);
    assert.equal(await fs.readFile(sentinel,'utf8'),'outside sentinel');
  }
  await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest));
  // Missing referenced media must never produce a successful backup, even when DB is valid.
  await fs.rename(media,media+'-hidden');
  assert.throws(()=>run(['--import',hook,'scripts/backup.mjs','--out',path.join(temp,'incomplete-backups')]),e=>String(e.stderr).includes('snapshot is incomplete'));
  env.PACKAGE_MEDIA_ROOT=media+'-hidden';
  assert.match(run(['--import',hook,'scripts/backup.mjs','--out',path.join(temp,'override-backups')]),/Backup complete/);
  await fs.rename(media+'-hidden',media); env.PACKAGE_MEDIA_ROOT='';
  const source = path.join(backup,'database/fixture.db');
  const corrupt=await fs.readFile(source); corrupt[100]^=1; await fs.writeFile(source,corrupt);
  assert.throws(()=>run(['scripts/restore.mjs','--in',backup,'--out',target,'--force']),e=>String(e.stderr).includes('checksum'));
  assert.deepEqual(await fs.readFile(path.join(target,'fixture.db')),before,'Damaged backup must not overwrite target');
  console.log('PASS pre-mutation DB integrity/count/media-reference checks, source/target sentinels, genuine v1 compatibility, backup snapshot counts, copied upload hashes, symlink exclusion, verified restore, sidecar rejection, legacy compatibility, media hashes and corrupt/missing/symlink database/upload/media-source preservation.');
} finally { await db?.$disconnect(); await fs.rm(temp,{recursive:true,force:true}); }
