import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
import json
import io
import contextlib
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reset_crm', ROOT/'scripts/vps-reset-crm.py')
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)

class ResetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'test.db'
        self.db = sqlite3.connect(self.path)
        for migration in sorted((ROOT/'prisma/migrations').glob('*/migration.sql')):
            self.db.executescript(migration.read_text(encoding='utf-8'))
        self.db.execute('CREATE TABLE _prisma_migrations(id TEXT PRIMARY KEY,checksum TEXT)')
        self.db.execute("INSERT INTO _prisma_migrations VALUES('migration','unchanged')")
        self.db.execute('PRAGMA foreign_keys=OFF')
        self.insert('Role', id='role', key='OWNER', name='Owner', desc='Fixture')
        self.insert('Branch', id='branch', name='Test branch', code='TEST', city='Test')
        self.insert('User', id='owner', employeeCode='OWNER', name='Test owner', email='owner@example.test', passwordHash='unchanged-password-hash', roleId='role', branchId='branch', active=1, phone='')
        self.insert('Settings', id='setting', key='counter.case', value='42')
        self.insert('Customer', id='customer', code='C-TEST', name='Test customer', assignedToId='owner', branchId='branch')
        self.insert('Task', id='task', title='Test task', ownerId='owner', creatorId='owner', customerId='customer', branchId='branch')
        self.insert('FinancialEntry', id='ledger', partyType='CUSTOMER', partyId='customer', sourceType='TEST', sourceId='test', revision=1, amountMinor=100, reference='TEST', description='Test journal')
        self.insert('AuditLog', id='audit', userId='owner', action='LOGIN', entity='User')
        self.insert('PlatformEvent', id='event', bodyHash='unchanged', aggregateId='old-booking')
        self.db.commit()
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def insert(self, table, **values):
        for _, name, kind, required, default, _ in self.db.execute('PRAGMA table_info('+reset.quote(table)+')'):
            if required and default is None and name not in values:
                values[name] = 1 if any(x in kind.upper() for x in ('INT','REAL','FLOAT','DECIMAL','BOOL','DATE')) else 'fixture-'+name
        self.db.execute('INSERT INTO '+reset.quote(table)+'('+','.join(reset.quote(k) for k in values)+') VALUES('+','.join('?' for _ in values)+')', tuple(values.values()))

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_business_cleared_auth_settings_audit_dedup_and_schema_preserved(self):
        before = {t: reset.digest_table(self.db,t) for t in reset.KEEP}
        result = reset.clean_candidate(self.path, 'OWNER@EXAMPLE.TEST')
        for table in reset.BUSINESS:
            self.assertEqual(self.db.execute('SELECT count(*) FROM '+reset.quote(table)).fetchone()[0], 0)
        for table, digest in before.items():
            self.assertEqual(reset.digest_table(self.db,table,result['resetAuditId'] if table=='AuditLog' else None),digest)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertEqual(result['cleared']['Customer'],1)

    def test_wrong_or_inactive_owner_refused(self):
        with self.assertRaises(reset.ResetError): reset.clean_candidate(self.path,'other@example.test')
        self.db.execute('UPDATE User SET active=0'); self.db.commit()
        with self.assertRaises(reset.ResetError): reset.clean_candidate(self.path,'owner@example.test')
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],1)

    def test_unknown_schema_refused(self):
        self.db.execute('CREATE TABLE FutureBusiness(id TEXT)'); self.db.commit()
        with self.assertRaises(reset.ResetError): reset.clean_candidate(self.path,'owner@example.test')

    def test_uncertain_external_command_refused(self):
        self.insert('PlatformCommand',id='command',bookingId='external',actorId='owner',request='{}',state='UNKNOWN');self.db.commit()
        with self.assertRaises(reset.ResetError): reset.clean_candidate(self.path,'owner@example.test')

    def test_delete_failure_rolls_back_whole_candidate(self):
        self.db.execute("CREATE TRIGGER reject_reset BEFORE DELETE ON Customer BEGIN SELECT RAISE(ABORT,'synthetic'); END");self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):reset.clean_candidate(self.path,'owner@example.test')
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM FinancialEntry').fetchone()[0],1)

    def test_native_install_handles_existing_wal(self):
        self.db.execute('PRAGMA journal_mode=WAL')
        candidate=Path(self.temp.name)/'candidate.db'
        with closing(sqlite3.connect(candidate)) as target:self.db.backup(target)
        reset.clean_candidate(candidate,'owner@example.test')
        with closing(reset.readonly(candidate)) as source,closing(sqlite3.connect(self.path)) as destination:source.backup(destination)
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT passwordHash FROM User').fetchone()[0],'unchanged-password-hash')
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchall(),[('ok',)])

    def test_database_mapping_rejects_nonpersistent_and_traversal(self):
        container={'Mounts':[{'RW':True,'Destination':'/data','Source':self.temp.name}]}
        self.assertEqual(reset.host_database(container,{'DATABASE_URL':'file:/data/test.db'}),self.path.resolve())
        for url in ('file:relative.db','postgresql://localhost/live','file:/data/../test.db','file:/outside/test.db'):
            with self.assertRaises(reset.ResetError):reset.host_database(container,{'DATABASE_URL':url})

    def fake_job(self, fail_backup=False):
        directory=Path(self.temp.name)/'recovery';directory.mkdir()
        mount={'RW':True,'Destination':'/data','Source':self.temp.name}
        container={'Id':'crm','Name':'/max-travel-crm-app-1','Mounts':[mount],'Config':{'Labels':{'com.docker.compose.service':'app'}}}
        stack={'app':'max-travel-crm-app-1','services':['app','worker'],'containers':[container],'before':'before.json','env':{'DATABASE_URL':'file:/data/test.db'}}
        calls=[]
        def run(args,**kwargs):
            calls.append(args)
            if args[:3]==['docker','ps','-q']:return 'crm'
            if args[:2]==['docker','inspect']:return json.dumps({'id':'crm','mounts':[mount]})
            return ''
        def once(stack,file,args,*options):
            calls.append(args)
            if args[0]=='scripts/backup.mjs':
                if fail_backup:raise reset.ResetError('Synthetic backup failure')
                output=directory/'crm-backups/backup-test';output.mkdir();(output/'manifest.json').write_text('{}')
        def write(name,value):(directory/name).write_text(json.dumps(value))
        return SimpleNamespace(directory=directory,snapshot=lambda *args:stack,run=run,compose=lambda stack,file,*args:['compose',*args],once=once,write=write,health=lambda stack:calls.append(['HEALTH'])),calls

    def test_inspection_never_stops_or_clears(self):
        job,calls=self.fake_job()
        with contextlib.redirect_stdout(io.StringIO()):reset.reset_crm(job,'owner@example.test',False)
        self.assertFalse(any('stop' in c for c in calls))
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],1)

    def test_orchestration_verifies_backup_before_reset_and_resumes_only_crm(self):
        job,calls=self.fake_job()
        with contextlib.redirect_stdout(io.StringIO()):reset.reset_crm(job,'owner@example.test',True)
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],0)
        self.assertLess(next(i for i,c in enumerate(calls) if c[0]=='scripts/restore.mjs'),next(i for i,c in enumerate(calls) if 'up' in c))
        self.assertTrue(any('worker' in c and 'up' in c for c in calls))
        self.assertFalse(any('booking' in x for c in calls for x in c))

    def test_backup_failure_preserves_data_and_resumes_original_services(self):
        job,calls=self.fake_job(fail_backup=True)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(reset.ResetError):reset.reset_crm(job,'owner@example.test',True)
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],1)
        self.assertTrue(any('up' in c and 'app' in c and 'worker' in c for c in calls))

    def test_unknown_writer_blocks_before_stop(self):
        job,calls=self.fake_job();original=job.run
        def run(args,**kw):
            if args[:2]==['docker','inspect']:return json.dumps({'id':'another-project','mounts':[{'RW':True,'Source':self.temp.name}]})
            return original(args,**kw)
        job.run=run
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(reset.ResetError):reset.reset_crm(job,'owner@example.test',True)
        self.assertFalse(any('stop' in c for c in calls))

if __name__=='__main__':unittest.main()
