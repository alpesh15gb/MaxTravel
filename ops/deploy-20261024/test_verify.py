import copy, importlib.util, json, pathlib, subprocess, tempfile, unittest, os
import verify as v
class Checks(unittest.TestCase):
 def fixture(self):
  rows=[]
  for app,names in [('crm',['app','worker']),('booking',['app','postgres'])]:
   p=v.PINS[app]
   for name in names:
    rows.append({'Id':app+name,'Image':p['image'] if name!='postgres' else 'postgres-image','RestartCount':0,'State':{'Running':True,'Health':{'Status':'healthy'}},'Config':{'Labels':{'com.docker.compose.project':'max-travel-'+app,'com.docker.compose.service':name,'com.docker.compose.project.working_dir':p['live'],'com.docker.compose.project.config_files':','.join(p['release']+'/'+f for f in p['files'])}},'HostConfig':{},'Mounts':[]})
  return rows
 def test_runtime_pass(self): self.assertEqual(len(v.runtime(self.fixture())),4)
 def test_wrong_image(self):
  r=self.fixture();r[0]['Image']='unexpected'
  with self.assertRaises(SystemExit):v.runtime(r)
 def test_extra_writer(self):
  r=self.fixture();w=copy.deepcopy(r[-2]);w['Config']['Labels']['com.docker.compose.service']='crm-worker';r.append(w)
  with self.assertRaises(SystemExit):v.runtime(r)
 def test_bad_pointer(self):
  r=self.fixture();r[0]['Config']['Labels']['com.docker.compose.project.config_files']='/tmp/unsafe.yaml'
  with self.assertRaises(SystemExit):v.runtime(r)
 def test_unhealthy(self):
  r=self.fixture();r[0]['State']['Health']['Status']='unhealthy'
  with self.assertRaises(SystemExit):v.runtime(r)
 def test_restarted(self):
  r=self.fixture();r[0]['RestartCount']=1
  with self.assertRaises(SystemExit):v.runtime(r)
 def test_symlink(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/'real').write_text('x');(p/'link').symlink_to(p/'real')
   with self.assertRaises(SystemExit):v.regular(p/'link')
 def call(self,mode,*args): return subprocess.run(['python3',str(pathlib.Path(v.__file__)),mode,*map(str,args)],capture_output=True)
 def test_source_modes(self):
  with tempfile.TemporaryDirectory() as d:
   f=pathlib.Path(d)/'tree';f.write_text('100644 blob '+'a'*40+'\tscripts/start.mjs\n');self.assertEqual(self.call('source',f).returncode,0)
   for line in ['120000 blob '+'a'*40+'\tlink\n','100644 blob '+'a'*40+'\t.env.production\n','160000 commit '+'a'*40+'\tsubmodule\n']:
    f.write_text(line);self.assertNotEqual(self.call('source',f).returncode,0)
 def test_builder_caps(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d); t=p/'builder';j=p/'inspect'
   t.write_text('Name: capped\nDriver: docker-container\nNodes:\nName: capped0\nEndpoint: unix:///var/run/docker.sock\nStatus: running\n')
   rows=[{'Name':'/buildx_buildkit_capped0','State':{'Running':True},'HostConfig':{'Memory':6*1024**3,'MemorySwap':8*1024**3,'CpuPeriod':100000,'CpuQuota':200000}}]
   j.write_text(json.dumps(rows));self.assertEqual(self.call('builder',t,j,'capped').returncode,0)
   rows[0]['HostConfig']['Memory']=0;j.write_text(json.dumps(rows));self.assertNotEqual(self.call('builder',t,j,'capped').returncode,0)
 def test_after_detects_recreation(self):
  with tempfile.TemporaryDirectory() as d:
   a=pathlib.Path(d)/'a';b=pathlib.Path(d)/'b';rows=self.fixture();a.write_text(json.dumps(rows));b.write_text(json.dumps(rows))
   self.assertEqual(self.call('after',a,b).returncode,0)
   rows[0]['Id']='recreated';b.write_text(json.dumps(rows));self.assertNotEqual(self.call('after',a,b).returncode,0)
 def test_effective_env_keeps_image_defaults_and_blank(self):
  image={'Config':{'Env':['PATH=/usr/bin','NODE_VERSION=24','DEFAULT_BLANK=']}}
  service={'environment':{'JWT_SECRET':'frozen','EXPLICIT_BLANK':''}}
  container={'Config':{'Env':['PATH=/usr/bin','NODE_VERSION=24','DEFAULT_BLANK=','JWT_SECRET=frozen','EXPLICIT_BLANK=']}}
  v.environment_matches(container,image,service)
 def test_missing_frozen_env_rejected(self):
  image={'Config':{'Env':['PATH=/usr/bin']}}
  container={'Config':{'Env':['PATH=/usr/bin','SMTP_HOST=live-secret']}}
  with self.assertRaises(SystemExit):v.environment_matches(container,image,{'environment':{}})
 def test_blank_and_unset_distinct(self):
  image={'Config':{'Env':['REMOVE=default','BLANK=default']}}
  service={'environment':{'REMOVE':None,'BLANK':''}}
  v.environment_matches({'Config':{'Env':['BLANK=']}},image,service)
  with self.assertRaises(SystemExit):v.environment_matches({'Config':{'Env':['REMOVE=','BLANK=']}},image,service)
 def test_same_id_manual_restart_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   a=pathlib.Path(d)/'a';b=pathlib.Path(d)/'b';rows=self.fixture()
   rows[0]['State'].update(StartedAt='2026-10-24T00:00:00Z',FinishedAt='0001-01-01T00:00:00Z',Paused=False,Restarting=False,Dead=False,OOMKilled=False)
   a.write_text(json.dumps(rows));rows[0]['State']['StartedAt']='2026-10-24T01:00:00Z';b.write_text(json.dumps(rows))
   self.assertNotEqual(self.call('after',a,b).returncode,0)
 def test_sanitized_compose_blocks_caller_precedence(self):
  with tempfile.TemporaryDirectory() as d:
   fake=pathlib.Path(d)/'docker';fake.write_text('#!/usr/bin/python3\nimport os,json,sys\nprint(json.dumps({"env":dict(os.environ),"argv":sys.argv}))\n');fake.chmod(0o755)
   script=(pathlib.Path(v.__file__).parent/'preserve-build.sh').read_text()
   line=next(line for line in script.splitlines() if line.startswith('COMPOSE=('))
   command='DOCKER_BIN="$1"; APP=booking; LIVE=/opt/max-travel-booking/booking-platform; OLD_RELEASE=/root/frozen; ENV_NAME=compose.env; '+line+'; "${COMPOSE[@]}" config --format json'
   env=dict(os.environ,SMTP_HOST='caller-override',JWT_SECRET='caller-override',COMPOSE_PROFILES='surprise')
   result=subprocess.run(['bash','-c',command,'test',str(fake)],env=env,capture_output=True,text=True,check=True)
   data=json.loads(result.stdout)
   self.assertNotIn('SMTP_HOST',data['env']);self.assertNotIn('JWT_SECRET',data['env']);self.assertNotIn('COMPOSE_PROFILES',data['env'])
   self.assertIn('/root/frozen/compose.env',data['argv']);self.assertIn('/root/.docker',data['argv'])
 def test_postgres_password_drift_rejected(self):
  image={'Config':{'Env':['PG_MAJOR=17','PATH=/usr/bin']}}
  container={'Config':{'Labels':{'com.docker.compose.service':'postgres'},'Env':['PG_MAJOR=17','PATH=/usr/bin','POSTGRES_PASSWORD=running-password']}}
  with self.assertRaises(SystemExit):v.environment_matches(container,image,{'environment':{'POSTGRES_PASSWORD':'drifted-password'}})
 def retained_fixture(self):
  row=copy.deepcopy(self.fixture()[0]);row['Id']=v.RETAINED_CHECK_ID;row['Name']=v.RETAINED_CHECK_NAME
  row['Image']='historical-helper-image-not-required-for-build'
  row['State']={'Status':'exited','ExitCode':0,'Running':False,'Paused':False,'Restarting':False,'Dead':False,'OOMKilled':False,'StartedAt':'old-start','FinishedAt':'old-finish'}
  row['Config']['Labels'].pop('com.docker.compose.oneoff',None)
  return row
 def test_only_confirmed_retained_helper_is_eligible_exclusion(self):
  rows=self.fixture()+[self.retained_fixture()];before=copy.deepcopy(rows)
  eligible=v.runtime(rows)
  self.assertEqual(len(eligible),4);self.assertEqual(rows,before)
  self.assertNotIn('historical-helper-image-not-required-for-build',{r['Image'] for r in eligible.values()})
 def test_retained_identity_mismatches_rejected(self):
  for field,value in [('Id','different-id'),('Name','/different-name')]:
   with self.subTest(field=field):
    row=self.retained_fixture();row[field]=value
    with self.assertRaises(SystemExit):v.runtime(self.fixture()+[row])
  for field in ['com.docker.compose.project','com.docker.compose.service']:
   with self.subTest(label=field):
    row=self.retained_fixture();row['Config']['Labels'][field]='different'
    with self.assertRaises(SystemExit):v.runtime(self.fixture()+[row])
 def test_retained_state_mismatches_rejected(self):
  for field,value in [('Running',True),('Status','running'),('ExitCode',1),('Paused',True),('Restarting',True),('Dead',True),('OOMKilled',True)]:
   with self.subTest(field=field):
    row=self.retained_fixture();row['State'][field]=value
    with self.assertRaises(SystemExit):v.runtime(self.fixture()+[row])
 def test_no_generic_oneoff_or_stopped_exemption(self):
  for running in [False,True]:
   row=self.retained_fixture();row['Id']='other';row['Name']='/other';row['Config']['Labels']['com.docker.compose.oneoff']='True';row['State']['Running']=running
   with self.assertRaises(SystemExit):v.runtime(self.fixture()+[row])
  rows=self.fixture();rows[0]['State']['Running']=False
  with self.assertRaises(SystemExit):v.runtime(rows)
 def test_retained_helper_stays_in_after_guard(self):
  with tempfile.TemporaryDirectory() as d:
   a=pathlib.Path(d)/'a';b=pathlib.Path(d)/'b';rows=self.fixture()+[self.retained_fixture()]
   a.write_text(json.dumps(rows));b.write_text(json.dumps(rows));self.assertEqual(self.call('after',a,b).returncode,0)
   for variant in ['removed','restarted','renamed','exit-drift']:
    changed=copy.deepcopy(rows)
    if variant=='removed':changed.pop()
    elif variant=='restarted':changed[-1]['State']['StartedAt']='new-start'
    elif variant=='renamed':changed[-1]['Name']='/renamed'
    else:changed[-1]['State']['ExitCode']=1
    b.write_text(json.dumps(changed));self.assertNotEqual(self.call('after',a,b).returncode,0)
 def test_final_marker_order_and_content(self):
  script=(pathlib.Path(v.__file__).parent/'preserve-build.sh').read_text()
  self.assertLess(script.index('sha256sum --check --status "$STAGE/frozen-originals.sha256"'),script.index("<<'PYVERIFIED'"))
  self.assertLess(script.index('verify.py" after'),script.index("<<'PYVERIFIED'"))
  body=script.split("<<'PYVERIFIED'\n",1)[1].split('\nPYVERIFIED',1)[0]
  with tempfile.TemporaryDirectory() as d:
   subprocess.run(['python3','-',d,'crm',v.PINS['crm']['commit'],v.PINS['crm']['tree'],'sha256:'+'a'*64],input=body,text=True,check=True)
   marker=json.loads((pathlib.Path(d)/'build-verified.json').read_text())
   self.assertEqual(marker['stage'],d);self.assertEqual(marker['status'],'verified');self.assertEqual(marker['commit'],v.PINS['crm']['commit']);self.assertEqual(marker['tree'],v.PINS['crm']['tree']);self.assertEqual(marker['image'],'sha256:'+'a'*64)
 def mount_fixture(self):
  return [{'Type':'volume','Name':'example','Source':'/var/lib/docker/volumes/example/_data','Destination':'/data','Driver':'local','Mode':'rw','RW':True,'Propagation':'','ExtraOptions':{'copy':True}}, {'Type':'bind','Source':'/srv/backups','Destination':'/backups','Mode':'ro','RW':False,'Propagation':'rprivate'}]
 def test_mount_order_only_passes(self):
  mounts=self.mount_fixture();self.assertEqual(v.canonical_mounts(mounts),v.canonical_mounts(list(reversed(mounts))))
  with tempfile.TemporaryDirectory() as d:
   a=pathlib.Path(d)/'a';b=pathlib.Path(d)/'b';rows=self.fixture();rows[0]['Mounts']=mounts;a.write_text(json.dumps(rows));rows[0]['Mounts']=list(reversed(mounts));b.write_text(json.dumps(rows))
   self.assertEqual(self.call('after',a,b).returncode,0)
 def test_mount_full_value_changes_rejected(self):
  mounts=self.mount_fixture()
  for field,value in [('Source','/different'),('Destination','/different'),('RW',False),('Propagation','shared'),('Type','bind'),('Mode','ro'),('ExtraOptions',{'copy':False})]:
   with self.subTest(field=field):
    changed=copy.deepcopy(mounts);changed[0][field]=value;self.assertNotEqual(v.canonical_mounts(mounts),v.canonical_mounts(changed))
  for changed in [mounts[:-1],mounts+[mounts[0]],[mounts[0],mounts[0]]]:self.assertNotEqual(v.canonical_mounts(mounts),v.canonical_mounts(changed))
 def test_command_env_order_not_normalized(self):
  with tempfile.TemporaryDirectory() as d:
   a=pathlib.Path(d)/'a';b=pathlib.Path(d)/'b'
   for field in ['Cmd','Entrypoint','Env']:
    rows=self.fixture();rows[0]['Config'][field]=['one','two'];a.write_text(json.dumps(rows));rows[0]['Config'][field]=['two','one'];b.write_text(json.dumps(rows));self.assertNotEqual(self.call('after',a,b).returncode,0)
if __name__=='__main__':unittest.main()
