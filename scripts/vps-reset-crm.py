#!/usr/bin/env python3
"""Owner-requested CRM test-data reset. Inspect by default; SQLite only. Never touches booking."""
import argparse
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import sys
import time
from urllib.parse import unquote, urlsplit
import uuid

HELPER_SHA = '5b88f65d42e5b006cdfecc092c254c9196669bb5762ef776a1e75027f44a5fac'
KEEP = set('Branch Role User Settings VisaStage Checklist ChecklistItem QuickReply TravelPackage PackageMedia StaffSession StaffMfa StaffRecovery StaffAuthFailure AuditLog PlatformEvent _prisma_migrations'.split())
BUSINESS = set('FinancialEntry ServiceCase DataImportBatch DataImportIdentity ServiceCaseEvent ServiceCaseMutation Customer Traveller VisaCase CaseTraveller VisaCaseStatus ChecklistLink Document DocumentAccessLog UploadLink Booking BookingTraveller Ticket Reissue Payment Invoice InvoiceCreditNote Supplier SupplierDue SupplierSettlement Refund Task ServiceWork WorkEvent WorkMutation TaskComment Note WhatsAppThread WhatsAppMessage CaseMessage WhatsAppAttachment Notification Activity WhatsAppInbound PlatformCommand PlatformCustomerLink PlatformBookingLink SalesLead SalesQuote IncomingMedia FinancialMutation'.split())

class ResetError(Exception):
    pass

def quote(name):
    return '"' + name.replace('"', '""') + '"'

def inspect_database(db, email):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if tables != KEEP | BUSINESS:
        raise ResetError('Database schema differs from the reviewed release. No data cleared.')
    owners = db.execute('SELECT u.id,u.active,r.key FROM "User" u JOIN "Role" r ON r.id=u.roleId WHERE lower(u.email)=?', (email.strip().lower(),)).fetchall()
    if len(owners) != 1 or not owners[0][1] or owners[0][2] not in ('OWNER', 'SUPER_ADMIN'):
        raise ResetError('The specified email must uniquely identify an active CRM owner. No data cleared.')
    if db.execute("SELECT count(*) FROM PlatformCommand WHERE state IN ('STARTED','UNKNOWN')").fetchone()[0]:
        raise ResetError('Unresolved booking commands require review before clearing CRM data.')
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
        raise ResetError('Database integrity or relations need review before resetting.')
    return owners[0][0], {t: db.execute('SELECT count(*) FROM ' + quote(t)).fetchone()[0] for t in sorted(tables)}

def digest_table(db, table, excluded=None):
    rows = db.execute('SELECT * FROM ' + quote(table) + (' WHERE id<>?' if excluded else ''), (excluded,) if excluded else ()).fetchall()
    encoded = sorted(json.dumps(r, default=lambda b: {'bytes': bytes(b).hex()}, separators=(',', ':')) for r in rows)
    return hashlib.sha256('\n'.join(encoded).encode()).hexdigest()

def clean_candidate(path, email):
    db = sqlite3.connect(path)
    try:
        owner, before = inspect_database(db, email)
        preserved = {t: digest_table(db, t) for t in KEEP}
        schema = db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()
        audit = uuid.uuid4().hex
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('BEGIN IMMEDIATE')
        for table in sorted(BUSINESS):
            db.execute('DELETE FROM ' + quote(table))
        db.execute('INSERT INTO AuditLog(id,userId,action,entity,detail,at) VALUES(?,?,?,?,?,?)',
                   (audit, owner, 'TEST_DATA_RESET', 'CRM', json.dumps({'scope': 'CRM business test data only', 'cleared': {t: before[t] for t in sorted(BUSINESS)}}), int(time.time()*1000)))
        for table, expected in preserved.items():
            if digest_table(db, table, audit if table == 'AuditLog' else None) != expected:
                raise ResetError('A preserved record changed. Candidate discarded.')
        if any(db.execute('SELECT count(*) FROM ' + quote(t)).fetchone()[0] for t in BUSINESS):
            raise ResetError('Candidate still contains business records.')
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ResetError('Candidate has broken references.')
        if schema != db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall():
            raise ResetError('Candidate schema changed unexpectedly.')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ResetError('Candidate integrity check failed.')
        return {'cleared': {t: before[t] for t in sorted(BUSINESS)}, 'preserved': {t: before[t] for t in sorted(KEEP)}, 'resetAuditId': audit}
    finally:
        db.close()

def host_database(container, env):
    url = urlsplit(env.get('DATABASE_URL', ''))
    target = PurePosixPath(unquote(url.path))
    if url.scheme != 'file' or url.netloc or not target.is_absolute() or '..' in target.parts:
        raise ResetError('This reviewed tool supports an absolute SQLite database path only.')
    matches = [m for m in container['Mounts'] if m.get('RW') and (str(target) == m['Destination'] or str(target).startswith(m['Destination'].rstrip('/')+'/'))]
    if not matches:
        raise ResetError('CRM database must be on an existing writable persistent mount.')
    mount = max(matches, key=lambda m: len(m['Destination']))
    base = Path(mount['Source']).resolve()
    path = base.joinpath(*target.relative_to(PurePosixPath(mount['Destination'])).parts)
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):
        raise ResetError('Unexpected CRM database mount path.')
    return path.resolve()

def readonly(path):
    return sqlite3.connect(path.as_uri()+'?mode=ro', uri=True)

def check_writers(job, path, stack):
    identities = job.run(['docker','ps','-q']).split()
    if not identities:
        raise ResetError('Running CRM containers could not be verified.')
    allowed = {c['Id'] for c in stack['containers'] if (c.get('Config',{}).get('Labels') or {}).get('com.docker.compose.service') in stack['services']}
    raw = job.run(['docker','inspect','--format','{"id":{{json .Id}},"mounts":{{json .Mounts}}}',*identities])
    for line in raw.splitlines():
        row = json.loads(line)
        for mount in row['mounts']:
            if mount.get('RW') and path.is_relative_to(Path(mount['Source']).resolve()) and row['id'] not in allowed:
                raise ResetError('Another running container can write the CRM database. Review that writer before resetting; no service changed.')

def reset_crm(job, email, apply):
    stack = job.snapshot('max-travel-crm-app-1', 'max-travel-crm')
    container = next(c for c in stack['containers'] if c['Name'].lstrip('/') == stack['app'])
    path = host_database(container, stack['env'])
    check_writers(job, path, stack)
    with closing(readonly(path)) as db:
        _, counts = inspect_database(db, email)
    print('Reset scope: entire CRM workspace business test records, across staff and branches. Booking is untouched.', flush=True)
    print('Rows to clear: '+json.dumps({t:counts[t] for t in sorted(BUSINESS)}), flush=True)
    print('Preserved: staff/logins/MFA, branches, settings/credentials/counters, templates/catalogue, security audit and booking event deduplication.', flush=True)
    if not apply:
        print('Inspection only. No service stopped; application data and configuration unchanged.')
        return
    paused = installed = False
    try:
        paused = True
        job.run(job.compose(stack, stack['before'], 'stop', '-t', '270', *stack['services']))
        # Existing operator backup includes the database, private uploads and catalogue media.
        backups = job.directory/'crm-backups'
        backups.mkdir(mode=0o700)
        bind = str(backups)+':/maxtravel-recovery'
        job.once(stack, stack['before'], ['scripts/backup.mjs', '--out', '/maxtravel-recovery'], '--user', '0', '--volume', bind)
        manifests = list(backups.glob('backup-*/manifest.json'))
        if len(manifests) != 1:
            raise ResetError('A unique full backup manifest was not produced.')
        job.once(stack, stack['before'], ['scripts/restore.mjs', '--in', '/maxtravel-recovery/'+manifests[0].parent.name, '--out', '/maxtravel-recovery/restore-check'], '--user', '0', '--volume', bind)
        # Use SQLite's snapshot API, not a raw copy of a potentially WAL-backed file.
        candidate = job.directory/'empty-business-candidate.db'
        with closing(readonly(path)) as source, closing(sqlite3.connect(candidate)) as target:
            source.backup(target)
        report = clean_candidate(candidate, email)
        job.write('reset-plan-and-verification.json', report)
        with closing(readonly(candidate)) as source, closing(sqlite3.connect(path, timeout=30)) as destination:
            # Native backup installation handles the destination journal/WAL atomically;
            # do not swap the live filename or delete its sidecars.
            source.backup(destination)
        installed = True
        owner_stat = path.stat()
        for suffix in ('-wal','-shm'):
            companion = Path(str(path)+suffix)
            if companion.is_symlink():
                raise ResetError('Unexpected SQLite sidecar link; services remain stopped for review.')
            if companion.exists():
                os.chown(companion, owner_stat.st_uid, owner_stat.st_gid)
                os.chmod(companion, owner_stat.st_mode & 0o666)
        with closing(readonly(path)) as db:
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ResetError('Installed database verification failed; services remain stopped for recovery.')
            if any(db.execute('SELECT count(*) FROM '+quote(t)).fetchone()[0] for t in BUSINESS):
                raise ResetError('Installed database contains unexpected business rows.')
        job.run(job.compose(stack, stack['before'], 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'))
        job.health(stack)
        workers = [s for s in stack['services'] if s != 'app']
        if workers:
            job.run(job.compose(stack, stack['before'], 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', *workers))
        job.write('reset-completed.json', {'complete': True, 'bookingUntouched': True, 'backupRestoreVerified': True})
        print('CRM test business data cleared and app healthy. Previously active CRM workers resumed. Booking unchanged. No messages or supplier/payment operations were initiated.', flush=True)
        print('Private backups and old unreferenced uploads retained for recovery: '+str(job.directory), flush=True)
    except BaseException:
        if paused and not installed:
            job.run(job.compose(stack, stack['before'], 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', *stack['services']))
        elif installed:
            print('The reset was installed but startup verification did not complete. Do not restore over possible new writes automatically. Keep recovery directory and inspect service status.', flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', required=True)
    parser.add_argument('--owner-email', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise ResetError('Run from the Linux VPS root terminal.')
    os.umask(0o077)
    helper = Path(args.helper).resolve()
    if hashlib.sha256(helper.read_bytes()).hexdigest() != HELPER_SHA:
        raise ResetError('Updater helper checksum mismatch.')
    spec = importlib.util.spec_from_file_location('reviewed_update', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    job = module.Update()
    print('Private CRM reset recovery directory: '+str(job.directory), flush=True)
    return reset_crm(job, args.owner_email, args.apply)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Private deployment helper errors already contain only safe log paths.
        print(str(error) if isinstance(error, ResetError) or error.__class__.__name__ == 'StopUpdate' else 'Reset stopped; no private error/configuration contents printed ('+type(error).__name__+').', flush=True)
        sys.exit(1)
