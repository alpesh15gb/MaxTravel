#!/usr/bin/env python3
"""Configure one stable private CRM encryption key. Inspect by default; never resets data."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
import re
import secrets
import sys

HELPER_SHA = '5b88f65d42e5b006cdfecc092c254c9196669bb5762ef776a1e75027f44a5fac'
KEY = 'CRM_DATA_ENCRYPTION_KEY'
KEY_FILE = Path('/opt/max-travel-crm-secrets/data-encryption.key')

class SetupError(Exception):
    pass

# Only aggregate counts leave the container. Raw encrypted values and keys never do.
PROBE = r"""const{PrismaClient}=require('@prisma/client');const{createDecipheriv}=require('node:crypto');const p=new PrismaClient();
(async()=>{try{let encryptedRecords=0;const verify=process.argv.includes('verify');const key=process.env.CRM_DATA_ENCRYPTION_KEY||'';const valid=/^[a-f0-9]{64}$/i.test(key);if(verify&&!valid)throw Error();
const check=(value,context,required=false)=>{if(!value)return;let raw=value;if(raw.startsWith('enc:'))raw=raw.slice(4);if(!raw.startsWith('v1.')){if(required||value.startsWith('enc:'))throw Error();return;}encryptedRecords++;if(verify){const[v,iv,tag,data]=raw.split('.');if(v!=='v1'||!iv||!tag||!data)throw Error();const c=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64url'));c.setAAD(Buffer.from(context));c.setAuthTag(Buffer.from(tag,'base64url'));Buffer.concat([c.update(Buffer.from(data,'base64url')),c.final()]);}};
const sources=[['user','id',{bankAccount:'crm-field:bankAccount'}],['traveller','id',{passportNumber:'crm-field:passportNumber'}],['document','id',{extracted:'crm-field:extracted'}],['staffMfa','userId',{secret:'staff-mfa:'}],['dataImportBatch','id',{payload:'import-payload:',preview:'import-preview:'}]];
for(const[model,id,fields]of sources){let cursor;while(true){const rows=await p[model].findMany({take:500,orderBy:{[id]:'asc'},...(cursor?{cursor:{[id]:cursor},skip:1}:{}),select:{[id]:true,...Object.fromEntries(Object.keys(fields).map(k=>[k,true]))}});for(const row of rows)for(const[field,context]of Object.entries(fields))check(row[field],context.endsWith(':')?context+row[id]:context,model==='staffMfa'||model==='dataImportBatch');if(rows.length<500)break;cursor=rows[rows.length-1][id];}}
const uncertainCommands=await p.platformCommand.count({where:{state:{in:['STARTED','UNKNOWN']}}});
console.log(JSON.stringify({encryptedRecords,uncertainCommands,keyConfigured:valid,keyVerified:verify}));
}finally{await p.$disconnect()}})().catch(()=>{console.error('Private-data verification failed; no values printed.');process.exitCode=1});"""

def valid_key(value):
    return isinstance(value, str) and re.fullmatch(r'[a-fA-F0-9]{64}', value) is not None

def private_file(path):
    if path.is_symlink() or path.parent.is_symlink() or not path.is_file():
        raise SetupError('The private key path must be a regular file, not a link.')
    if os.name == 'posix' and (path.stat().st_uid != 0 or path.stat().st_mode & 0o077):
        raise SetupError('The existing key file must be root-owned and readable only by root.')
    value = path.read_text().rstrip('\r\n')
    if not valid_key(value):
        raise SetupError('The retained private key has an invalid format; no replacement was generated.')
    return value.lower()

def key_sources(config, key_file):
    if key_file.parent.is_symlink():
        raise SetupError('The private key directory cannot be a link.')
    targets = {name: spec for name,spec in config['services'].items() if name == 'app' or 'worker' in name}
    if 'app' not in targets:
        raise SetupError('The existing CRM application is missing.')
    values = []
    for spec in targets.values():
        env = spec.get('environment') or {}
        if not isinstance(env, dict):
            raise SetupError('CRM environment must be normalized before configuration.')
        value = env.get(KEY)
        if value:
            if not valid_key(value):
                raise SetupError('An existing CRM service has an invalid encryption key. Review it before configuration.')
            values.append(value.lower())
    if key_file.exists() or key_file.is_symlink():
        values.append(private_file(key_file))
    unique = set(values)
    if len(unique) > 1:
        raise SetupError('Different existing CRM encryption keys were found. No key was replaced.')
    return list(targets), next(iter(unique), None)

def select_key(existing, encrypted_records):
    if existing:
        return existing
    if encrypted_records:
        raise SetupError('Encrypted CRM records already exist. Recover their original key; a new key cannot unlock them.')
    return secrets.token_hex(32)

def candidate_config(config, targets, key):
    if not valid_key(key):
        raise SetupError('Invalid candidate key.')
    result = copy.deepcopy(config)
    for service in targets:
        result['services'][service].setdefault('environment', {})[KEY] = key
    return result

def retain_key(path, key):
    if path.exists() or path.is_symlink():
        if private_file(path) != key:
            raise SetupError('Retained key differs from the verified key. No key file changed.')
        return
    if path.parent.is_symlink():
        raise SetupError('The private key directory cannot be a link.')
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name == 'posix' and (path.parent.stat().st_uid != 0 or path.parent.stat().st_mode & 0o077):
        raise SetupError('The private key directory must be root-owned and private.')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    with os.fdopen(os.open(path, flags, 0o600), 'w') as output:
        output.write(key+'\n')
        output.flush()
        os.fsync(output.fileno())

def check_database_writers(job, stack):
    original = next(c for c in stack['containers'] if c['Name'].lstrip('/') == stack['app'])
    url = urlsplit(stack['env'].get('DATABASE_URL',''))
    target = PurePosixPath(unquote(url.path))
    if url.scheme != 'file' or url.netloc or not target.is_absolute() or '..' in target.parts:
        raise SetupError('Expected an absolute SQLite database path.')
    mounts = [m for m in original.get('Mounts',[]) if m.get('RW') and (str(target) == m['Destination'] or str(target).startswith(m['Destination'].rstrip('/')+'/'))]
    if not mounts:
        raise SetupError('The CRM database must use an existing writable persistent mount.')
    mount = max(mounts,key=lambda m:len(m['Destination']))
    base = Path(mount['Source']).resolve()
    database = base.joinpath(*target.relative_to(PurePosixPath(mount['Destination'])).parts)
    if database.is_symlink() or not database.is_file() or not database.resolve().is_relative_to(base):
        raise SetupError('Unexpected CRM database mount path.')
    ids = job.run(['docker','ps','-q']).split()
    if not ids:
        raise SetupError('Running containers could not be verified.')
    allowed = {c['Id'] for c in stack['containers'] if (c.get('Config',{}).get('Labels') or {}).get('com.docker.compose.service') in stack['services']}
    raw = job.run(['docker','inspect','--format','{"id":{{json .Id}},"mounts":{{json .Mounts}}}',*ids])
    for line in raw.splitlines():
        container = json.loads(line)
        for volume in container['mounts']:
            if volume.get('RW') and volume.get('Source') and database.resolve().is_relative_to(Path(volume['Source']).resolve()) and container['id'] not in allowed:
                raise SetupError('Another running container can write the CRM database. Review that writer before enabling encryption.')

def configure(job, apply, key_file=KEY_FILE):
    stack = job.snapshot('max-travel-crm-app-1', 'max-travel-crm')
    if not stack['env'].get('DATABASE_URL', '').startswith('file:/'):
        raise SetupError('This reviewed setup expects the existing SQLite CRM.')
    check_database_writers(job,stack)
    targets, existing = key_sources(stack['config'], key_file)
    ready = json.loads(job.run(['docker','exec',stack['app'],'node','-e',PROBE]))
    if ready['uncertainCommands']:
        raise SetupError('Review uncertain CRM booking commands before changing configuration.')
    if ready['encryptedRecords'] and not existing:
        raise SetupError('Existing encrypted records require the original key. No replacement was generated.')
    print('CRM encryption readiness: '+json.dumps({'keyAvailable':bool(existing),'encryptedRecords':ready['encryptedRecords'],'applicationConfigured':ready['keyConfigured'],'configuredServices':len(targets)}), flush=True)
    if not apply:
        print('Inspection only. No key generated, services restarted or application data changed.')
        return
    if existing and key_file.exists() and all(((stack['config']['services'][s].get('environment') or {}).get(KEY) or '').lower() == existing for s in targets):
        json.loads(job.run(['docker','exec',stack['app'],'node','-e',PROBE,'--','verify']))
        print('Encryption is already configured consistently. No restart or key rotation performed.')
        return
    paused = cutover = False
    try:
        current = job.inspect('container',stack['app'])
        original = next(c for c in stack['containers'] if c['Name'].lstrip('/') == stack['app'])
        if current['Id'] != original['Id']:
            raise SetupError('The CRM application changed after inspection. Run inspection again.')
        paused = True
        job.run(job.compose(stack,stack['before'],'stop','-t','270',*stack['services']))
        backups = job.directory/'crm-backups'
        backups.mkdir(mode=0o700)
        bind = str(backups)+':/maxtravel-recovery'
        job.once(stack,stack['before'],['scripts/backup.mjs','--out','/maxtravel-recovery'],'--user','0','--volume',bind)
        manifests = list(backups.glob('backup-*/manifest.json'))
        if len(manifests) != 1:
            raise SetupError('A unique CRM backup was not produced.')
        job.once(stack,stack['before'],['scripts/restore.mjs','--in','/maxtravel-recovery/'+manifests[0].parent.name,'--out','/maxtravel-recovery/restore-check'],'--user','0','--volume',bind)
        # Recheck after stopping all active app workers; do not rely on the live preflight alone.
        stable = json.loads(job.once(stack,stack['before'],['-e',PROBE]))
        if stable['uncertainCommands']:
            raise SetupError('An uncertain CRM command appeared. Setup stopped before configuration.')
        key = select_key(existing, stable['encryptedRecords'])
        candidate = candidate_config(stack['config'],targets,key)
        after = job.write_compose('crm-encryption-enabled.private.json',candidate)
        job.run(job.compose(stack,after,'config','--quiet'))
        proof = json.loads(job.once(stack,after,['-e',PROBE,'--','verify']))
        if not proof['keyConfigured'] or not proof['keyVerified']:
            raise SetupError('The candidate encryption key could not be verified.')
        retain_key(key_file,key)
        # Once the app starts, it may encrypt new writes. Never roll back to a missing key after this point.
        cutover = True
        job.run(job.compose(stack,after,'up','-d','--no-deps','--no-build','--pull','never','app'))
        job.health(stack)
        current = json.loads(job.run(['docker','exec',stack['app'],'node','-e',PROBE,'--','verify']))
        if not current['keyConfigured'] or not current['keyVerified']:
            raise SetupError('The running application did not verify encryption.')
        workers = [s for s in stack['services'] if s != 'app']
        if workers:
            job.run(job.compose(stack,after,'up','-d','--no-deps','--no-build','--pull','never',*workers))
        job.write('encryption-setup-completed.json',{'complete':True,'keyFile':str(key_file),'existingKeyReused':bool(existing),'backupRestoreVerified':True,'bookingUntouched':True})
        print('CRM encryption configured and app healthy. Previously active CRM workers resumed. Reload the Imports page.', flush=True)
        print('Keep this root-private key file with protected backups: '+str(key_file), flush=True)
        print('No records, accounts, MFA enforcement, booking settings or payments were changed.', flush=True)
    except BaseException:
        if paused and not cutover:
            job.run(job.compose(stack,stack['before'],'up','-d','--no-deps','--no-build','--pull','never',*stack['services']))
        elif cutover:
            print('The key was retained and startup was attempted. Keep the new key/configuration; do not revert to a missing key after possible new writes. Review private diagnostics; workers remain paused unless already resumed.', flush=True)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise SetupError('Run from the Linux VPS root terminal.')
    os.umask(0o077)
    helper = Path(args.helper).resolve()
    if hashlib.sha256(helper.read_bytes()).hexdigest() != HELPER_SHA:
        raise SetupError('Reviewed updater helper checksum mismatch.')
    spec = importlib.util.spec_from_file_location('reviewed_update',helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    job = module.Update()
    print('Private encryption recovery directory: '+str(job.directory), flush=True)
    configure(job,args.apply)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error,SetupError) or error.__class__.__name__ == 'StopUpdate' else 'Encryption setup stopped. Keep the recovery directory; private configuration and error contents were not printed ('+type(error).__name__+').',flush=True)
        sys.exit(1)
