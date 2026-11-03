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

    def test_audit_only_removes_history_without_changing_business_or_auth(self):
        before={t:reset.digest_table(self.db,t) for t in reset.KEEP|reset.BUSINESS if t!='AuditLog'}
        result=reset.clean_audit_candidate(self.path,'owner@example.test')
        self.assertEqual(result['cleared']['AuditLog'],1)
        self.assertEqual(self.db.execute('SELECT action FROM AuditLog').fetchall(),[('AUDIT_HISTORY_CLEARED',)])
        for table,value in before.items():self.assertEqual(reset.digest_table(self.db,table),value)

    def test_audit_only_wrong_owner_cannot_clear_history(self):
        with self.assertRaises(reset.ResetError):reset.clean_audit_candidate(self.path,'unknown@example.test')
        self.assertEqual(self.db.execute('SELECT action FROM AuditLog').fetchone()[0],'LOGIN')

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

    def test_audit_only_orchestration_does_not_repeat_business_reset(self):
        job,calls=self.fake_job()
        with contextlib.redirect_stdout(io.StringIO()):reset.reset_crm(job,'owner@example.test',True,audit_only=True)
        self.assertEqual(self.db.execute('SELECT count(*) FROM Customer').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM FinancialEntry').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT action FROM AuditLog').fetchone()[0],'AUDIT_HISTORY_CLEARED')

    def test_unknown_writer_blocks_before_stop(self):
        job,calls=self.fake_job();original=job.run
        def run(args,**kw):
            if args[:2]==['docker','inspect']:return json.dumps({'id':'another-project','mounts':[{'RW':True,'Source':self.temp.name}]})
            return original(args,**kw)
        job.run=run
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(reset.ResetError):reset.reset_crm(job,'owner@example.test',True)
        self.assertFalse(any('stop' in c for c in calls))

    def counters_and_configuration(self):
        for index,key in enumerate(reset.BUSINESS_COUNTERS):
            self.db.execute('INSERT INTO Settings(id,key,value) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('business-counter-'+str(index),key,'42'))
        self.insert('Settings',id='staff-counter',key='counter.EMP',value='7')
        self.insert('Settings',id='future-counter',key='counter.FUTURE',value='99')
        self.insert('Settings',id='smtp-config',key='smtp.configuration',value='retain-private-configuration')
        self.insert('Settings',id='case-config',key='case.configuration',value='{"referencePrefix":"MX"}')
        self.db.commit()

    def test_combined_reset_clears_history_and_only_known_business_counters(self):
        self.counters_and_configuration()
        user_hash=reset.digest_table(self.db,'User')
        result=reset.clean_candidate(self.path,'owner@example.test',clear_audit=True,reset_numbering=True)
        self.assertEqual(result['cleared']['AuditLog'],1)
        self.assertEqual(result['clearedHistoricalNotices'],0)
        self.assertEqual({key.casefold() for key in result['resetCounterKeys']},reset.BUSINESS_COUNTER_KEYS)
        self.assertEqual(self.db.execute('SELECT action FROM AuditLog').fetchall(),[('TEST_DATA_RESET',)])
        for key in reset.BUSINESS_COUNTERS:self.assertIsNone(self.db.execute('SELECT value FROM Settings WHERE key=?',(key,)).fetchone())
        for key,value in [('counter.EMP','7'),('counter.FUTURE','99'),('smtp.configuration','retain-private-configuration'),('case.configuration','{"referencePrefix":"MX"}')]:
            self.assertEqual(self.db.execute('SELECT value FROM Settings WHERE key=?',(key,)).fetchone()[0],value)
        self.assertEqual(reset.digest_table(self.db,'User'),user_hash)

    def test_numbering_is_not_reset_without_explicit_flag(self):
        self.counters_and_configuration()
        reset.clean_candidate(self.path,'owner@example.test',clear_audit=True)
        for key in reset.BUSINESS_COUNTERS:self.assertEqual(self.db.execute('SELECT value FROM Settings WHERE key=?',(key,)).fetchone()[0],'42')
        self.assertEqual(self.db.execute('SELECT count(*) FROM AuditLog').fetchone()[0],1)

    def test_numbering_reset_can_keep_previous_audit_history(self):
        self.counters_and_configuration()
        reset.clean_candidate(self.path,'owner@example.test',reset_numbering=True)
        self.assertEqual(self.db.execute('SELECT count(*) FROM AuditLog').fetchone()[0],2)
        self.assertIsNone(self.db.execute('SELECT value FROM Settings WHERE key=?',('counter.CASE',)).fetchone())

    def test_counter_cleanup_failure_rolls_back_business_and_audit_deletion(self):
        self.counters_and_configuration()
        self.db.execute("CREATE TRIGGER reject_counter_reset BEFORE DELETE ON Settings WHEN OLD.key='counter.CASE' BEGIN SELECT RAISE(ABORT,'synthetic'); END")
        self.db.commit()
        before={t:reset.digest_table(self.db,t) for t in reset.KEEP|reset.BUSINESS}
        with self.assertRaises(sqlite3.IntegrityError):reset.clean_candidate(self.path,'owner@example.test',True,True)
        for table,value in before.items():self.assertEqual(reset.digest_table(self.db,table),value)

    def test_audit_only_refuses_numbering_or_combined_flags_before_inspection(self):
        job=SimpleNamespace(snapshot=lambda *args:(_ for _ in ()).throw(AssertionError('Unexpected inspection')))
        for clear_audit,reset_numbering in [(True,False),(False,True),(True,True)]:
            with self.assertRaises(reset.ResetError):reset.reset_crm(job,'owner@example.test',True,audit_only=True,clear_audit=clear_audit,reset_numbering=reset_numbering)

    def test_combined_dry_run_changes_nothing(self):
        self.counters_and_configuration()
        before={t:reset.digest_table(self.db,t) for t in reset.KEEP|reset.BUSINESS}
        job,calls=self.fake_job()
        with contextlib.redirect_stdout(io.StringIO()):reset.reset_crm(job,'owner@example.test',False,clear_audit=True,reset_numbering=True)
        for table,value in before.items():self.assertEqual(reset.digest_table(self.db,table),value)
        self.assertFalse(any('stop' in c for c in calls))

    def test_combined_install_retains_staff_and_config_and_restarts_only_crm(self):
        self.counters_and_configuration()
        user_hash=reset.digest_table(self.db,'User')
        job,calls=self.fake_job()
        with contextlib.redirect_stdout(io.StringIO()):reset.reset_crm(job,'owner@example.test',True,clear_audit=True,reset_numbering=True)
        self.assertEqual(reset.digest_table(self.db,'User'),user_hash)
        self.assertEqual(self.db.execute('SELECT count(*) FROM AuditLog').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT value FROM Settings WHERE key=?',('counter.EMP',)).fetchone()[0],'7')
        self.assertIsNone(self.db.execute('SELECT value FROM Settings WHERE key=?',('counter.CASE',)).fetchone())
        report=json.loads((job.directory/'reset-completed.json').read_text())
        self.assertTrue(report['businessNumberingReset']);self.assertTrue(report['auditHistoryCleared']);self.assertTrue(report['staffNumberingRetained'])
        self.assertFalse(any('booking' in str(c) for c in calls))

    def test_counter_allowlist_matches_real_reference_allocator_except_staff(self):
        import re
        source=(ROOT/'src/lib/transactions.ts').read_text(encoding='utf-8')
        body=source.split('const COUNTERS:',1)[1].split('};',1)[0]
        prefixes=set(re.findall(r'^  ([A-Z]+):',body,re.M))
        self.assertEqual(set(reset.BUSINESS_COUNTERS),{'counter.'+key for key in prefixes if key!='EMP'})

if __name__=='__main__':unittest.main()
