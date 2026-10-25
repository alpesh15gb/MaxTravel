#!/usr/bin/env python3
"""Offline contract/syntax tests only: no Docker, provider, network, or database calls."""
import unittest,pathlib,json,copy,sys,tempfile,subprocess,re,ast,unittest.mock as mock
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));import phase_verify as v

def row(id='id',service='app',project='crm'):
 return {'Id':id,'Image':'sha256:x','RestartCount':0,'Config':{'Labels':{'com.docker.compose.project':'max-travel-'+project,'com.docker.compose.service':service}},'HostConfig':{},'Mounts':[],'NetworkSettings':{'Networks':{'n':{}}},'State':{'Running':True,'StartedAt':'t','Health':{'Status':'healthy'}}}
def mounted():
 a=row();a['Config'].update(Env=['A=1','B=2'],Hostname='id',Cmd=['node','server.js'],Entrypoint=['sh','entrypoint.sh'])
 a['Mounts']=[{'Type':'volume','Name':'data','Source':'/var/lib/docker/volumes/data/_data','Destination':'/data','Driver':'local','Mode':'rw','RW':True,'Propagation':'','Options':{'flags':['first','second']}},{'Type':'bind','Source':'/private/backup','Destination':'/backup','Mode':'ro','RW':False,'Propagation':'rprivate'}]
 return a
class Contracts(unittest.TestCase):
 def test_protected_good(self):v.protected([row()],[row()],'')
 def test_same_id_restart(self):
  r=row();r['State']['StartedAt']='new'
  with self.assertRaises(SystemExit):v.protected([row()],[r],'')
 def test_extra_container(self):
  with self.assertRaises(SystemExit):v.protected([row()],[row(),row('extra','postgres','booking')],'')
 def test_scoped_change(self):v.protected([row(),row('pg','postgres','booking')],[row('new'),row('pg','postgres','booking')],'crm:app')
 def test_scope_does_not_hide_pg(self):
  r=row('pg','postgres','booking');r['Image']='different'
  with self.assertRaises(SystemExit):v.protected([row(),row('pg','postgres','booking')],[row('new'),r],'crm:app')
 def test_schema_drift(self):
  with mock.patch.object(v.subprocess,'check_output',side_effect=[v.PINS['crm']['tree'],'prisma/schema.prisma\n']):
   with self.assertRaises(SystemExit):v.source('crm','/unused')
 def test_shell_syntax(self):
  for path in HERE.glob('*.sh'):subprocess.run(['bash','-n',str(path)],check=True)
 def test_embedded_python(self):
  for path in HERE.glob('*.sh'):
   for match in re.finditer(r"<<'(PY[A-Z_]*)'[^\n]*\n(.*?)\n\1\n",path.read_text(),re.S):ast.parse(match[2],filename=str(path))
 def test_crm_resume_syntax(self):
  text=(HERE/'freeze-backup-verify-crm.sh').read_text();body=re.search(r'cat > "\$STAGE/resume-old.sh" <<RESUME\n(.*?)\nRESUME',text,re.S)[1]
  # Let bash perform genuine heredoc expansion in a temporary directory. Shell commands
  # in the resume body are escaped in the template and must NOT execute at generation.
  with tempfile.TemporaryDirectory() as tmp:
   script='set -eu\n'+''.join(k+'='+json.dumps(tmp if k=='STAGE' else 'fixture')+'\n' for k in ['STAGE','BUILD','APP','WORKER','OLD_IMAGE','BACKUP_HELPER','RESTORE_HELPER'])+'cat > "$STAGE/resume.sh" <<RESUME\n'+body+'\nRESUME\nbash -n "$STAGE/resume.sh"\n'
   subprocess.run(['bash','-c',script],check=True)
 def test_no_migration_candidate(self):
  s=(HERE/'cutover-crm-app-only.sh').read_text();self.assertIn('RUN_MIGRATIONS: "false"',s);self.assertNotIn('prisma migrate deploy',s)
 def test_audit_all_tables_and_sequences(self):
  s=(HERE/'audit-crm.cjs').read_text();self.assertIn("schema.filter(r=>r.type==='table')",s);self.assertIn('sqlite_sequence',s);self.assertIn('checksum!==digest',s)
 def test_retained_artifact_not_excluded(self):
  r=row('cdd10ab33db2d17a04e1a861def28366dcc2ee60b54c55285a86b7071d87f33e');r['Name']='/max-travel-crm-upgrade-check-56e110ae';r['State'].update(Status='exited',ExitCode=0,Running=False,Paused=False,Restarting=False,Dead=False,OOMKilled=False)
  n=copy.deepcopy(r);n['RestartCount']=1
  with self.assertRaises(SystemExit):v.protected([r],[n],'crm:app')
 def test_tree_audit_rejects_symlink(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);(p/'uploads').mkdir();(p/'uploads'/'bad').symlink_to('/nonexistent')
   result=subprocess.run(['node',str(HERE/'audit-tree.cjs'),tmp],capture_output=True)
   self.assertNotEqual(result.returncode,0)
 def test_tree_audit_content_and_empty_directories(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);(p/'uploads'/'empty').mkdir(parents=True);(p/'uploads'/'document').write_bytes(b'example')
   result=subprocess.run(['node',str(HERE/'audit-tree.cjs'),tmp],capture_output=True,check=True)
   data=json.loads(result.stdout);self.assertIn(['empty/','directory'],data['uploads']['files']);self.assertFalse(data['packageMedia']['present'])
 def test_runtime_security_change_rejected(self):
  a=row();b=copy.deepcopy(a);a['Config'].update(Env=[],Hostname='id');b['Config'].update(Env=[],Hostname='id');b['HostConfig']['Privileged']=True
  with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'crm')
 def test_runtime_custom_hostname_change_rejected(self):
  a=row();b=copy.deepcopy(a);a['Config'].update(Env=[],Hostname='custom');b['Config'].update(Env=[],Hostname='changed')
  with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'crm')
 def test_duplicate_allowed_service_rejected(self):
  with self.assertRaises(SystemExit):v.protected([row()],[row('new'),row('extra')],'crm:app')
 def test_runtime_duplicate_service_rejected(self):
  with self.assertRaises(SystemExit):v.runtime_equal([row()],[row('new'),row('extra')],'crm')
 def test_unchanged_historical_replacement_label_allowed(self):
  a=row('worker','worker');a['Config'].update(Env=[],Hostname='worker');a['Config']['Labels']['com.docker.compose.replace']='historical'
  v.runtime_equal([a],[copy.deepcopy(a)],'crm')
 def test_full_mount_order_ignored_in_protection_and_runtime(self):
  a=mounted();b=copy.deepcopy(a);b['Mounts'].reverse()
  v.protected([a],[b],'');v.runtime_equal([a],[b],'booking')
 def test_all_mount_field_mutations_rejected(self):
  a=mounted()
  variants=[('Source','/different'),('Destination','/elsewhere'),('Type','bind'),('RW',False),('Propagation','rshared'),('Mode','ro'),('Driver','different'),('Name','other'),('UnknownExtra','new'),('Options',{'flags':['second','first']})]
  for key,value in variants:
   with self.subTest(field=key):
    b=copy.deepcopy(a);b['Mounts'][0][key]=value
    with self.assertRaises(SystemExit):v.protected([a],[b],'')
    with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'booking')
 def test_mount_add_remove_and_duplicates_rejected(self):
  a=mounted()
  for mounts in [a['Mounts'][:1],a['Mounts']+[copy.deepcopy(a['Mounts'][0])],[a['Mounts'][0],a['Mounts'][0]]]:
   b=copy.deepcopy(a);b['Mounts']=mounts
   with self.assertRaises(SystemExit):v.protected([a],[b],'')
   with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'booking')
 def test_duplicate_multiplicity_preserved(self):
  a=mounted();a['Mounts'].append(copy.deepcopy(a['Mounts'][0]));b=copy.deepcopy(a);b['Mounts'].reverse()
  v.protected([a],[b],'');v.runtime_equal([a],[b],'booking')
 def test_nonmount_order_remains_strict_in_protection(self):
  for key in ['Cmd','Entrypoint','Env']:
   with self.subTest(field=key):
    a=mounted();b=copy.deepcopy(a);b['Config'][key].reverse()
    with self.assertRaises(SystemExit):v.protected([a],[b],'')
 def test_runtime_command_order_remains_strict(self):
  for key in ['Cmd','Entrypoint']:
   a=mounted();b=copy.deepcopy(a);b['Config'][key].reverse()
   with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'booking')
 def test_exact_crm_evidence_git_blobs(self):
  import hashlib
  fixtures={'docker-entrypoint.sh':(2306,'204f8af43add5268ce4ca6faae9a3c2df8b5d8ef','cf34b79a8e7e23cbe376555c4bb4c5ec29a4ce2a08aea9a8fe468a9b35124f5a'),'backup.mjs':(16554,'dfdfd66a18cdd499abd9d70de7ddde0692fe154f','7586e52b3740116a435e75c69731dc66bb64a9a060d52d43276130586bdf86c5'),'restore.mjs':(24706,'5ee510e2afe9205798feade563b68376d6bd662d','34333d2e9dc2e300f9ef78f90fea662a39ff60437bcd907b32d12bdb1336956f')}
  for name,(size,blob,digest) in fixtures.items():
   data=(HERE.parent/'evidence'/('crm-target-'+name)).read_bytes()
   self.assertEqual(len(data),size);self.assertEqual(hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),blob);self.assertEqual(hashlib.sha256(data).hexdigest(),digest)
 def test_crm_source_exact_bytes_accepted_extra_lf_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   scripts=pathlib.Path(tmp)/'source/scripts';scripts.mkdir(parents=True)
   names=['docker-entrypoint.sh','backup.mjs','restore.mjs']
   for name in names:(scripts/name).write_bytes((HERE.parent/'evidence'/('crm-target-'+name)).read_bytes())
   with mock.patch.object(v.subprocess,'check_output',side_effect=[v.PINS['crm']['tree'],'','{"scripts":{}}','{"scripts":{}}']):v.source('crm',tmp)
   for name in names:
    with self.subTest(file=name):
     p=scripts/name;original=p.read_bytes();p.write_bytes(original+b'\n')
     with mock.patch.object(v.subprocess,'check_output',side_effect=[v.PINS['crm']['tree'],'']):
      with self.assertRaises(SystemExit):v.source('crm',tmp)
     p.write_bytes(original)
 def test_snapshot_filter_exact_helper_label_only(self):
  rows=[]
  for i,labels in enumerate([None,{}, {'maxtravel.cutover.helper':'false'}, {'maxtravel.cutover.helper':'true'}, {'maxtravel.cutover.helper':True}, {'maxtravel.cutover.helper':'TRUE'}, {'maxtravel.cutover.helper':'true ','other':'value'}]):
   r=row(str(i),'postgres' if i==2 else 'app','booking' if i==2 else 'unrelated');r['Config']['Labels']=labels;rows.append(r)
  before=copy.deepcopy(rows);kept=v.non_helper_rows(rows)
  self.assertEqual([r['Id'] for r in kept],['0','1','2','4','5','6']);self.assertEqual(rows,before)
  self.assertIs(kept[2],rows[2])
 def test_snapshot_filter_empty_protected_inventory_rejected(self):
  r=row();r['Config']['Labels']['maxtravel.cutover.helper']='true'
  for rows in [[],[r]]:
   with self.assertRaises(SystemExit):v.non_helper_rows(rows)
 def test_no_unsupported_negated_docker_filters(self):
  for p in HERE.glob('*.sh'):
   self.assertNotRegex(p.read_text(),r'--filter[^\n]*(?:label!|label\s*!=)')
  common=(HERE/'common.sh').read_text();self.assertIn('ids=$(docker ps -aq --no-trunc)',common)
  self.assertIn('docker inspect $ids > "$1.all.private.json"',common)
  self.assertIn('snapshot-filter "$1.all.private.json" > "$1"',common)
 def test_first_snapshot_failure_precedes_crm_stop(self):
  s=(HERE/'freeze-backup-verify-crm.sh').read_text()
  first=s.index('snapshot_all "$STAGE/all-before.private.json"')
  self.assertLess(first,s.index('FROZEN=1'))
  self.assertLess(first,s.index('docker stop --timeout 260 "$WORKER"'))
  self.assertLess(first,s.index('docker stop --timeout 45 "$APP"'))
 def replacement_rows(self):
  a=mounted();a['Id']='a'*64;a['Name']='/max-travel-crm-app-1';a['Config']['Hostname']='a'*12;a['Config']['Labels']['com.docker.compose.container-number']='1';a['Config']['Labels']['com.docker.compose.replace']='app-1'
  b=copy.deepcopy(a);b['Id']='b'*64;b['Config']['Hostname']='b'*12;b['Config']['Env'].append('RUN_MIGRATIONS=false')
  return a,b
 def test_modern_exact_service_relative_replace(self):
  a,b=self.replacement_rows();v.runtime_equal([a],[b],'crm')
 def test_legacy_exact_id_replace(self):
  a,b=self.replacement_rows();b['Config']['Labels']['com.docker.compose.replace']=a['Id'];v.runtime_equal([a],[b],'crm')
 def test_replace_wrong_identity_rejected(self):
  for field,value in [('replace','other-1'),('replace','app-2'),('container-number','2'),('project','other'),('service','other')]:
   a,b=self.replacement_rows();b['Config']['Labels']['com.docker.compose.'+field]=value
   with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'crm')
  for which in ('old','new'):
   a,b=self.replacement_rows();(a if which=='old' else b)['Name']='/unrelated'
   with self.assertRaises(SystemExit):v.runtime_equal([a],[b],'crm')
 def test_incident_recovery_is_same_id_only_and_once(self):
  s=(HERE/'recover-crm-app-existing.sh').read_text()
  self.assertIn('APP=e7153d4b7464ca74d9583c4ad25b134eb5daff3e9c3d8e35c078ec531630675e',s)
  self.assertIn('! -e $RELEASE/app-recovery-attempted.txt',s)
  self.assertLess(s.index('> "$RELEASE/app-recovery-attempted.txt"'),s.index('docker update --restart='))
  self.assertLess(s.index('docker update --restart='),s.index('docker start "$APP"'))
  self.assertNotIn('docker start "$WORKER"',s)
  self.assertIn('RELEASE="$RECOVERY" quiesce_candidate app',s)
  self.assertNotRegex(s,r'(?m)^.*\b(?:up -d|--force-recreate|pg_restore|scripts/restore\.mjs)\b')
  self.assertGreater(s.index('> "$RELEASE/app-verified.txt"'),s.index('protected_check "$RELEASE/all-before.private.json" "$RECOVERY/all-after.private.json"'))
 def test_incident_recovery_python_is_optimization_isolated(self):
  s=(HERE/'recover-crm-app-existing.sh').read_text()
  for line in s.splitlines():
   if line.startswith('python3 '):self.assertTrue(line.startswith('python3 -I '))
  self.assertIn("n['Image']==s['Image']==contained[0]['Image']=='sha256:b10e495f4f8fbaca93153552e6484800670c91fa7e778a759674829b28cc3e0a'",s)
if __name__=='__main__':unittest.main()
