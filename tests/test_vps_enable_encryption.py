import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('enable',ROOT/'scripts/vps-enable-encryption.py')
enable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enable)
A = 'a'*64
B = 'b'*64

class EncryptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = self.root/'keys/data-encryption.key'
        self.config = {'services':{'app':{'image':'exact-app','environment':{'JWT_SECRET':'retained$secret','DATABASE_URL':'file:/data/app.db'},'volumes':[{'source':'existing','target':'/data'}]},'worker':{'image':'exact-worker','environment':{'WA_PROVIDER':'meta'}},'inactive-worker':{'image':'old-inactive','environment':{}},'postgres':{'environment':{'PASSWORD':'retained'}}},'volumes':{'existing':{'external':True,'name':'real-data'}}}

    def fake(self, encrypted=0, fail_backup=False, fail_health=False, paused_encrypted=None):
        recovery=self.root/'recovery';recovery.mkdir()
        (self.root/'app.db').write_text('unchanged database fixture')
        mount={'RW':True,'Source':str(self.root),'Destination':'/data','Type':'bind'}
        container={'Id':'crm-app','Name':'/max-travel-crm-app-1','Mounts':[mount],'Config':{'Labels':{'com.docker.compose.service':'app'}}}
        stack={'project':'max-travel-crm','app':'max-travel-crm-app-1','services':['app','worker'],'containers':[container],'env':{'DATABASE_URL':'file:/data/app.db'},'config':copy.deepcopy(self.config),'before':'before'}
        calls=[]
        readiness={'encryptedRecords':encrypted,'uncertainCommands':0,'keyConfigured':False,'keyVerified':False}
        def run(args,**kw):
            calls.append(args)
            if args[:3]==['docker','ps','-q']:return 'crm-app'
            if args[:2]==['docker','inspect']:return json.dumps({'id':'crm-app','mounts':[mount]})
            if args[:2]==['docker','exec']:
                return json.dumps({**readiness,**({'keyConfigured':True,'keyVerified':True} if 'verify' in args else {})})
            return ''
        def once(stack,file,args,*options):
            calls.append(args)
            if args[0]=='scripts/backup.mjs':
                if fail_backup:raise enable.SetupError('Synthetic backup failure')
                folder=recovery/'crm-backups/backup-test';folder.mkdir();(folder/'manifest.json').write_text('{}')
            if args[0]=='-e':return json.dumps({**readiness,'encryptedRecords':encrypted if paused_encrypted is None else paused_encrypted,**({'keyConfigured':True,'keyVerified':True} if 'verify' in args else {})})
            return ''
        def write(name,value):
            path=recovery/name;path.write_text(json.dumps(value));return path
        def health(stack):
            calls.append(['HEALTH'])
            if fail_health:raise enable.SetupError('Synthetic unhealthy startup')
        job=SimpleNamespace(directory=recovery,snapshot=lambda *args:stack,run=run,once=once,write=write,write_compose=write,compose=lambda stack,file,*args:['compose',*args],health=health,inspect=lambda *args:container)
        return job,calls,stack

    def invoke(self,job,apply):
        with contextlib.redirect_stdout(io.StringIO()) as output:enable.configure(job,apply,self.key)
        return output.getvalue()

    def test_missing_existing_key_generates_only_for_unencrypted_database(self):
        self.assertRegex(enable.select_key(None,0),r'^[a-f0-9]{64}$')
        with self.assertRaises(enable.SetupError):enable.select_key(None,1)
        self.assertEqual(enable.select_key(A,50),A)

    def test_live_worker_key_is_reused(self):
        self.config['services']['worker']['environment'][enable.KEY]=A
        targets,key=enable.key_sources(self.config,self.key)
        self.assertEqual(key,A);self.assertEqual(set(targets),{'app','worker','inactive-worker'})

    def test_mismatched_or_invalid_keys_are_not_replaced(self):
        for value in [B,'bad-format']:
            self.config['services']['app']['environment'][enable.KEY]=A
            self.config['services']['worker']['environment'][enable.KEY]=value
            with self.assertRaises(enable.SetupError):enable.key_sources(self.config,self.key)

    def test_private_key_file_is_stable_and_never_overwritten(self):
        enable.retain_key(self.key,A)
        enable.retain_key(self.key,A)
        self.assertEqual(enable.private_file(self.key),A)
        with self.assertRaises(enable.SetupError):enable.retain_key(self.key,B)
        self.assertEqual(self.key.read_text().strip(),A)

    def test_only_encryption_env_changes(self):
        original=copy.deepcopy(self.config)
        targets,_=enable.key_sources(self.config,self.key)
        result=enable.candidate_config(self.config,targets,A)
        for service in targets:
            self.assertEqual(result['services'][service]['environment'].pop(enable.KEY),A)
        self.assertEqual(result,original);self.assertEqual(self.config,original)

    def test_inspection_never_generates_key_or_stops_services(self):
        job,calls,_=self.fake()
        output=self.invoke(job,False)
        self.assertFalse(self.key.exists());self.assertFalse(any('stop' in c for c in calls));self.assertIn('Inspection only',output)

    def test_existing_ciphertext_blocks_missing_key_before_stop(self):
        job,calls,_=self.fake(encrypted=1)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(enable.SetupError):enable.configure(job,True,self.key)
        self.assertFalse(self.key.exists());self.assertFalse(any('stop' in c for c in calls))

    def test_backup_verified_before_cutover_and_only_active_workers_resume(self):
        job,calls,_=self.fake()
        output=self.invoke(job,True)
        candidate=json.loads((job.directory/'crm-encryption-enabled.private.json').read_text())
        key=self.key.read_text().strip();self.assertRegex(key,r'^[a-f0-9]{64}$');self.assertNotIn(key,output)
        for service in ['app','worker','inactive-worker']:self.assertEqual(candidate['services'][service]['environment'][enable.KEY],key)
        self.assertEqual((self.root/'app.db').read_text(),'unchanged database fixture')
        self.assertLess(next(i for i,c in enumerate(calls) if c[0]=='scripts/restore.mjs'),next(i for i,c in enumerate(calls) if 'up' in c))
        ups=[c for c in calls if 'up' in c];self.assertFalse(any('inactive-worker' in c or 'booking' in str(c) for c in ups));self.assertTrue(any(c[-1]=='worker' for c in ups))

    def test_backup_failure_resumes_original_without_a_key(self):
        job,calls,_=self.fake(fail_backup=True)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(enable.SetupError):enable.configure(job,True,self.key)
        self.assertFalse(self.key.exists());self.assertTrue(any('up' in c and c[-2:]==['app','worker'] for c in calls))

    def test_ciphertext_race_after_pause_refuses_generation(self):
        job,calls,_=self.fake(paused_encrypted=1)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(enable.SetupError):enable.configure(job,True,self.key)
        self.assertFalse(self.key.exists());self.assertFalse((job.directory/'crm-encryption-enabled.private.json').exists())

    def test_no_missing_key_rollback_after_app_might_have_written_ciphertext(self):
        job,calls,_=self.fake(fail_health=True)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(enable.SetupError):enable.configure(job,True,self.key)
        self.assertTrue(self.key.exists());self.assertEqual(len([c for c in calls if 'up' in c]),1)
        self.assertFalse(any(c[-1]=='worker' and 'up' in c for c in calls))

    def test_idempotent_config_never_rotates_or_restarts(self):
        enable.retain_key(self.key,A)
        for service in ['app','worker','inactive-worker']:self.config['services'][service]['environment'][enable.KEY]=A
        job,calls,_=self.fake()
        self.assertIn('already configured',self.invoke(job,True))
        self.assertFalse(any('stop' in c or 'up' in c for c in calls));self.assertEqual(self.key.read_text().strip(),A)

    def test_foreign_database_writer_refuses_before_restart(self):
        job,calls,_=self.fake();original=job.run
        def run(args,**kw):
            if args[:2]==['docker','inspect']:return json.dumps({'id':'unrelated-writer','mounts':[{'RW':True,'Source':str(self.root)}]})
            return original(args,**kw)
        job.run=run
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(enable.SetupError):enable.configure(job,True,self.key)
        self.assertFalse(any('stop' in c for c in calls));self.assertFalse(self.key.exists())

if __name__=='__main__':unittest.main()
