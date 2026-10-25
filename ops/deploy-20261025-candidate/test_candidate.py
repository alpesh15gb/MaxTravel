import copy, importlib.util, pathlib, subprocess, sys, unittest
import verify as v
import test_verify
HERE=pathlib.Path(__file__).parent
sys.path.insert(0,str(HERE/'cutover'))
import phase_verify as p
class CandidateChecks(unittest.TestCase):
 def test_exact_target_pins(self):
  self.assertEqual(v.PINS['crm']['commit'],'0d0c72d24c320d56710f3c640a151b34697dc4e6')
  self.assertEqual(v.PINS['booking']['commit'],'06615409f45c5ac9ef3b01b2538b26838ac0c69f')
 def test_pointer_is_not_env_directory(self):
  c=v.PINS['crm'];self.assertNotEqual(c['release'],c['pointer_release'])
  self.assertEqual(v.compose_paths('crm')[-1],c['pointer_release']+'/candidate-image.yaml')
  self.assertTrue(all(x.startswith(c['release']+'/') for x in v.compose_paths('crm')[:-1]))
  self.assertEqual(v.compose_paths('crm')[:-1],[c['release']+'/'+name for name in ['compose.vps.yaml','compose.evolution.yaml','image-override.yaml','candidate-image.yaml']])
  b=v.PINS['booking'];self.assertEqual(v.compose_paths('booking'),[b['release']+'/'+name for name in ['compose.production.yaml','image-override.yaml','candidate-image.yaml']])
 def test_missing_or_extra_overlay_rejected(self):
  for app,index in [('crm',0),('booking',2)]:
   for paths in [v.compose_paths(app)[:-1],v.compose_paths(app)+['/root/unknown.yaml'],[x for x in v.compose_paths(app) if x!=v.PINS[app]['release']+'/candidate-image.yaml']]:
    rows=test_verify.Checks().fixture();rows[index]['Config']['Labels']['com.docker.compose.project.config_files']=','.join(paths)
    with self.assertRaises(SystemExit):v.runtime(rows)
 def test_old_or_mixed_crm_image_rejected(self):
  for i in [0,1]:
   rows=test_verify.Checks().fixture();rows[i]['Image']='sha256:ee8cb38694f9713b6f816d218b27e5276efe2e572bcb3ac026dea7a6f9f0d37d'
   with self.assertRaises(SystemExit):v.runtime(rows)
 def test_stopped_worker_rejected(self):
  rows=test_verify.Checks().fixture();rows[1]['State']['Running']=False
  with self.assertRaises(SystemExit):v.runtime(rows)
 def test_phase_gate_requires_reviewed_baseline(self):
  from unittest.mock import patch
  with patch.object(v,'BUILD_BASELINE_REVIEWED',False),self.assertRaises(SystemExit):v.candidate_execution_gate()
  v.candidate_execution_gate()
 def test_execution_gates_before_mutation(self):
  s=(HERE/'preserve-build.sh').read_text();self.assertLess(s.index('candidate-build-gate'),s.index('exec 9>'))
  s=(HERE/'cutover/common.sh').read_text();self.assertLess(s.index('candidate-execution-gate'),s.index('exec 9>'))
  for f in ['revalidate-built-crm.sh','cutover/recover-crm-app-existing.sh']:
   s=(HERE/f).read_text();self.assertLess(s.index('exit 1'),s.index('source ') if 'source ' in s else s.index('HERE='))
 def test_build_gate_missing_or_unreviewed_baseline(self):
  from unittest.mock import patch
  with patch.object(v,'BUILD_BASELINE_REVIEWED',False),self.assertRaises(SystemExit):v.candidate_build_gate()
  with patch.object(v,'BUILD_BASELINE_REVIEWED',True),patch.object(v,'EXPECTED_BASELINE_IDS',{}),self.assertRaises(SystemExit):v.candidate_build_gate()
 def test_build_baseline_precedes_runtime_and_build(self):
  s=(HERE/'preserve-build.sh').read_text()
  self.assertLess(s.index('build-baseline'),s.index('"$HERE/verify.py" runtime'))
  self.assertLess(s.index('"$HERE/cutover/phase_verify.py" source'),s.index('timeout --kill-after=30s 35m'))
 def complete_rows(self):
  rows=test_verify.Checks().fixture()
  for n,r in enumerate(rows):
   r.update(Name='/synthetic-'+str(n),NetworkSettings={'Networks':{}},Mounts=[])
   r['State'].update(StartedAt='fixed',FinishedAt='fixed',Paused=False,Restarting=False,Dead=False,OOMKilled=False)
  return rows
 def test_completed_baseline_inventory(self):
  rows=self.complete_rows();ids={r['Config']['Labels']['com.docker.compose.project'].removeprefix('max-travel-')+':'+r['Config']['Labels']['com.docker.compose.service']:r['Id'] for r in rows}
  v.check_baseline_rows(rows,copy.deepcopy(rows),ids)
  changed=copy.deepcopy(rows);changed[1]['Id']='other'
  with self.assertRaises(SystemExit):v.check_baseline_rows(rows,changed,ids)
  changed=copy.deepcopy(rows);changed[0]['State']['StartedAt']='restarted'
  with self.assertRaises(SystemExit):v.check_baseline_rows(rows,changed,ids)
 def test_baseline_unrelated_container_preserved(self):
  rows=self.complete_rows();ids={r['Config']['Labels']['com.docker.compose.project'].removeprefix('max-travel-')+':'+r['Config']['Labels']['com.docker.compose.service']:r['Id'] for r in rows}
  other=copy.deepcopy(rows[0]);other['Id']='unrelated';other['Config']['Labels']['com.docker.compose.project']='unrelated';rows.append(other)
  with self.assertRaises(SystemExit):v.check_baseline_rows(rows,rows[:-1],ids)
 def test_private_completion_proof_accepts_and_rejects_bad_marker(self):
  import tempfile,json
  from unittest.mock import patch
  rows=self.complete_rows()
  for r in rows:
   key=r['Config']['Labels']['com.docker.compose.project'].removeprefix('max-travel-')+':'+r['Config']['Labels']['com.docker.compose.service']
   r['Id']=v.EXPECTED_BASELINE_IDS[key]
   if key=='booking:postgres':r['Image']=v.EXPECTED_POSTGRES_IMAGE
  with tempfile.TemporaryDirectory() as temp:
   d=pathlib.Path(temp);release=d/'release';release.mkdir();current=d/'current';current.write_text(json.dumps(rows))
   values={'app-verified.txt':'verified','deployed-source.txt':v.PINS['crm']['baseline'],'deployed-image.txt':v.PINS['crm']['image'],'all-final.private.json':json.dumps(rows),'final-containers.private.json':json.dumps(rows[:2])}
   for name,value in values.items():(release/name).write_text(value)
   for app in ('crm','booking'):(d/(app+'-pointer')).write_text(v.PINS[app]['pointer_release'])
   original_regular=v.regular
   def mapped(path):
    path=str(path)
    if path.startswith(v.PINS['crm']['pointer_release']+'/'):path=release/path.rsplit('/',1)[-1]
    elif path.startswith('/root/maxtravel-revamp-backup-9B5326/'):path=d/(path.rsplit('/',1)[-1].split('-')[0]+'-pointer')
    return original_regular(path)
   with patch.object(v,'regular',mapped):
    v.build_baseline(current)
    (release/'deployed-image.txt').write_text('wrong')
    with self.assertRaises(SystemExit):v.build_baseline(current)
    (release/'deployed-image.txt').write_text(v.PINS['crm']['image']);(release/'app-verified.txt').unlink()
    with self.assertRaises(SystemExit):v.build_baseline(current)
 def helper_rows(self):
  rows=self.complete_rows();h=copy.deepcopy(rows[0]);h['Id']='old-helper';h['Config']['Labels']={'maxtravel.cutover.helper':'true'}
  h['State'].update(Status='exited',ExitCode=0,Running=False,StartedAt='old',FinishedAt='old-finish');h['HostConfig']={'NetworkMode':'none','ReadonlyRootfs':True,'Privileged':False,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges']};h['Config']['User']='1000:1000';return rows+[h]
 def test_raw_build_to_phase_projection_preserves_old_helpers(self):
  rows=self.helper_rows();p.protected_build(rows,copy.deepcopy(rows),'')
  # Reproduce the original raw-vs-filtered mismatch without changing any runtime.
  with self.assertRaises(SystemExit):p.protected(rows,p.non_helper_rows(rows),'')
 def test_old_helpers_cannot_disappear_or_change(self):
  before=self.helper_rows()
  with self.assertRaises(SystemExit):p.protected_build(before,before[:-1],'')
  for field in ['Image','RestartCount','Config','HostConfig','Mounts','NetworkSettings','State']:
   after=copy.deepcopy(before)
   if field=='Image':after[-1][field]='different'
   elif field=='RestartCount':after[-1][field]=1
   elif field=='Config':after[-1][field]['Env']=['CHANGED=1']
   elif field=='HostConfig':after[-1][field]['Privileged']=True
   elif field=='Mounts':after[-1][field]=[{'Source':'/different'}]
   elif field=='NetworkSettings':after[-1][field]['Networks']={'other':{}}
   else:after[-1][field]['StartedAt']='restarted'
   with self.subTest(field=field),self.assertRaises(SystemExit):p.protected_build(before,after,'')
 def test_only_existing_exact_helper_policy_projects_new_rows(self):
  before=self.helper_rows()
  for label,accepted in [('true',True),('false',False),(True,False),(None,False),('TRUE',False)]:
   after=copy.deepcopy(before);h=copy.deepcopy(after[-1]);h['Id']='new-helper'
   if label is None:h['Config']['Labels']={}
   else:h['Config']['Labels']['maxtravel.cutover.helper']=label
   after.append(h)
   if accepted:
    with self.assertRaises(SystemExit):p.protected_build(before,after,'')
    p.protected_build(before,after,'crm:app,crm:worker',[copy.deepcopy(h)])
   else:
    with self.assertRaises(SystemExit):p.protected_build(before,after,'')
 def test_duplicate_raw_helper_ids_rejected(self):
  rows=self.helper_rows()
  with self.assertRaises(SystemExit):p.protected_build(rows+[copy.deepcopy(rows[-1])],rows,'')
  with self.assertRaises(SystemExit):p.protected_build(rows,rows+[copy.deepcopy(rows[-1])],'')
  after=copy.deepcopy(rows);h=copy.deepcopy(rows[-1]);h['Id']='new-helper';after.extend([h,copy.deepcopy(h)])
  with self.assertRaises(SystemExit):p.protected_build(rows,after,'')
 def test_booking_allows_only_its_preexisting_crm_service_exception(self):
  before=self.helper_rows();after=copy.deepcopy(before)
  after[0]['Id']='new-crm-app';after[1]['Id']='new-crm-worker'
  h=copy.deepcopy(after[-1]);h['Id']='new-crm-backup';after.append(h)
  p.protected_build(before,after,'crm:app,crm:worker',[copy.deepcopy(h)])
  with self.assertRaises(SystemExit):p.protected_build(before,after,'')
  h['Config']['Labels'].update({'com.docker.compose.project':'max-travel-crm','com.docker.compose.service':'app'});h['State']['Running']=True
  with self.assertRaises(SystemExit):p.protected_build(before,after,'crm:app,crm:worker')
 def test_new_helper_must_be_completed_and_isolated(self):
  before=self.helper_rows()
  for field,value in [('Running',True),('ExitCode',1),('OOMKilled',True),('Status','running')]:
   after=copy.deepcopy(before);h=copy.deepcopy(after[-1]);h['Id']='new-helper';h['State'][field]=value;after.append(h)
   with self.subTest(field=field),self.assertRaises(SystemExit):p.protected_build(before,after,'crm:app,crm:worker',[copy.deepcopy(h)])
  for field,value in [('NetworkMode','bridge'),('ReadonlyRootfs',False),('Privileged',True),('CapDrop',[]),('SecurityOpt',[])]:
   after=copy.deepcopy(before);h=copy.deepcopy(after[-1]);h['Id']='new-helper';h['HostConfig'][field]=value;after.append(h)
   with self.subTest(field=field),self.assertRaises(SystemExit):p.protected_build(before,after,'crm:app,crm:worker',[copy.deepcopy(h)])
 def test_new_peer_helper_complete_records_cannot_drift(self):
  before=self.helper_rows();after=copy.deepcopy(before);h=copy.deepcopy(after[-1]);h['Id']='new-helper';after.append(h);proof=[copy.deepcopy(h)]
  h['Mounts']=[{'Source':'/unexpected','RW':True}]
  with self.assertRaises(SystemExit):p.protected_build(before,after,'crm:app,crm:worker',proof)
  h['Mounts']=[];h['Image']='unexpected'
  with self.assertRaises(SystemExit):p.protected_build(before,after,'crm:app,crm:worker',proof)
 def test_completed_peer_helper_evidence_exact_names_and_images(self):
  import tempfile,json
  with tempfile.TemporaryDirectory() as temp:
   d=pathlib.Path(temp);release=d/'crm-release-target';release.mkdir();stage=d/'final-backup-test';stage.mkdir()
   (release/'snapshot-stage.txt').write_text(str(stage));(stage/'restore-verified.txt').write_text('verified');(stage/'helper-names.txt').write_text('backup\nrestore\n');(release/'deployed-image.txt').write_text('new-crm-image')
   a=copy.deepcopy(self.helper_rows()[-1]);a.update(Id='backup',Name='/backup',Image=v.PINS['crm']['image'])
   b=copy.deepcopy(a);b.update(Id='restore',Name='/restore',Image='new-crm-image')
   final=release/'all-final.private.json.all.private.json';final.write_text(json.dumps([a,b]))
   self.assertEqual([r['Id'] for r in p.completed_peer_helpers(release)],['backup','restore'])
   b['Image']='unexpected';final.write_text(json.dumps([a,b]))
   with self.assertRaises(SystemExit):p.completed_peer_helpers(release)
   (stage/'helper-names.txt').write_text('backup\nbackup\n')
   with self.assertRaises(SystemExit):p.completed_peer_helpers(release)
 def test_baseline_helper_label_change_rejected(self):
  before=self.helper_rows();after=copy.deepcopy(before);after[-1]['Config']['Labels']['maxtravel.cutover.helper']='false'
  with self.assertRaises(SystemExit):p.protected_build(before,after,'')
 def test_build_projection_keeps_unrelated_config_checks(self):
  before=self.helper_rows();after=copy.deepcopy(before);after[2]['HostConfig']['Privileged']=True
  with self.assertRaises(SystemExit):p.protected_build(before,after,'crm:app,crm:worker')
 def test_freeze_build_compare_uses_preserved_raw_evidence(self):
  for name in ['freeze-backup-verify-crm.sh','freeze-backup-verify-booking.sh']:
   s=(HERE/'cutover'/name).read_text()
   self.assertIn('protected_build_check "$BUILD/after.private.json" "$STAGE/all-before.private.json.all.private.json"',s)
   self.assertLess(s.index('protected_build_check'),s.index('FROZEN=1'))
 def test_exact_operational_allowlist(self):
  self.assertEqual(set(p.BOOKING_OPERATIONAL_SHA256),{'package.json','package-lock.json','scripts/verify-seo-http.mjs','scripts/crm-worker.mts','scripts/notification-worker.mts'})
  for name in p.BOOKING_OPERATIONAL_SHA256:
   with self.assertRaises(SystemExit):p.exact_booking_operational_bytes(name,b'changed')
  with self.assertRaises(SystemExit):p.exact_booking_operational_bytes('scripts/migrate.mjs',b'')
if __name__=='__main__':unittest.main()
