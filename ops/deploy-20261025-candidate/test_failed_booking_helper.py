import copy,json,pathlib,tempfile,unittest,sys
from unittest.mock import patch
import test_candidate
sys.path.insert(0,str(pathlib.Path(__file__).parent/'cutover'))
import phase_verify as p
class FailedHelperTests(unittest.TestCase):
 def fixture(self,d):
  stage=d/'final-backup-sQr9dj';stage.mkdir();cid='f'*64
  (stage/'isolated-container-id.txt').write_text(cid)
  rows=test_candidate.CandidateChecks().complete_rows();(stage/'all-before.private.json').write_text(json.dumps(rows))
  image={'Id':p.FAILED_POSTGRES_IMAGE,'Config':{'Env':['PATH=/usr/bin'],'Entrypoint':['docker-entrypoint.sh']}}
  (d/'deployed-images.private.json').write_text(json.dumps([image]))
  h=copy.deepcopy(rows[0]);h.update(Id=cid,Name='/booking-restore-final-backup-sqr9dj',Image=p.FAILED_POSTGRES_IMAGE)
  h['Config']={'User':'70:70','Cmd':['-c','listen_addresses=','-c','unix_socket_directories=/tmp'],'Entrypoint':['docker-entrypoint.sh'],'Labels':{'maxtravel.cutover.helper':'true'},'Env':['PATH=/usr/bin','PGHOST=/tmp','POSTGRES_USER=maxtravel','POSTGRES_DB=maxtravel','POSTGRES_HOST_AUTH_METHOD=trust']}
  h['State'].update(Status='exited',ExitCode=2,Running=False,Paused=False,Restarting=False,Dead=False,OOMKilled=False)
  h['HostConfig']={'NetworkMode':'none','ReadonlyRootfs':True,'Privileged':False,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges'],'Memory':1073741824,'NanoCpus':1000000000,'PidsLimit':256,'RestartPolicy':{'Name':'no','MaximumRetryCount':0},'Tmpfs':{'/tmp':'rw,nosuid,nodev,mode=1777','/var/run/postgresql':'rw,nosuid,nodev,mode=1777'}}
  h['Mounts']=[{'Type':'bind','Source':str(stage/'isolated-data'),'Destination':'/var/lib/postgresql/data','RW':True},{'Type':'tmpfs','Destination':'/tmp','RW':True},{'Type':'tmpfs','Destination':'/var/run/postgresql','RW':True}]
  return stage,rows+[h]
 def test_incident_exact_path(self):
  self.assertEqual(p.FAILED_BOOKING_STAGE,'/root/booking-build-0661540-wvdGUN/final-backup-sQr9dj')
  with self.assertRaises(SystemExit):p.failed_booking_helper('/tmp/unknown',[])
 def test_exact_stopped_incident_is_preserved(self):
  with tempfile.TemporaryDirectory() as t:
   stage,rows=self.fixture(pathlib.Path(t))
   with patch.object(p,'FAILED_BOOKING_STAGE',str(stage)):
    h=p.failed_booking_helper(stage,rows);self.assertEqual(h['Id'],'f'*64)
    bind_only=copy.deepcopy(rows);bind_only[-1]['Mounts']=bind_only[-1]['Mounts'][:1];p.failed_booking_helper(stage,bind_only)
    record=stage/'retained.json';record.write_text(json.dumps([h]));p.retained_helper_unchanged(record,rows)
    rows[-1]['State']['StartedAt']='changed'
    with self.assertRaises(SystemExit):p.retained_helper_unchanged(record,rows)
 def test_progress_markers_refuse_retention(self):
  with tempfile.TemporaryDirectory() as t:
   stage,rows=self.fixture(pathlib.Path(t))
   with patch.object(p,'FAILED_BOOKING_STAGE',str(stage)):
    for name in ['stop-app.log','database.dump','audit.sql','resume-old.sh','restore-verified.txt','cutover-attempted.txt','resumed-old.txt']:
     (stage/name).touch()
     with self.subTest(name=name),self.assertRaises(SystemExit):p.failed_booking_helper(stage,rows)
     (stage/name).unlink()
 def test_identity_state_mount_env_drift_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   stage,rows=self.fixture(pathlib.Path(t))
   with patch.object(p,'FAILED_BOOKING_STAGE',str(stage)):
    for change in ['id','image','name','running','oom','mount','env','entrypoint','network','ordinary']:
     current=copy.deepcopy(rows);h=current[-1]
     if change=='id':h['Id']='e'*64
     elif change=='image':h['Image']='unexpected'
     elif change=='name':h['Name']='/other'
     elif change=='running':h['State']['Running']=True
     elif change=='oom':h['State']['OOMKilled']=True
     elif change=='mount':h['Mounts'][0]['Source']='/live-data'
     elif change=='env':h['Config']['Env'].append('LD_PRELOAD=evil')
     elif change=='entrypoint':h['Config']['Entrypoint']=['sh']
     elif change=='network':h['HostConfig']['NetworkMode']='bridge'
     else:current[0]['HostConfig']['Privileged']=True
     with self.subTest(change=change),self.assertRaises(SystemExit):p.failed_booking_helper(stage,current)
 def test_actual_startup_smoke_and_final_server_gate(self):
  here=pathlib.Path(__file__).parent;s=(here/'test_postgres_startup_docker.sh').read_text();phase=(here/'cutover/freeze-backup-verify-booking.sh').read_text()
  self.assertIn('IMAGE=docker.io/library/postgres@sha256:d4bb',s);self.assertIn("image.get('RepoDigests',[])",s);self.assertIn("image['Architecture']=='amd64'",s);self.assertIn("postgres (PostgreSQL) 17.11",s);self.assertIn('eval "$COMMAND"',s);self.assertIn("s.index('docker run -d",s)
  self.assertIn('cat /proc/1/comm',s);self.assertIn('cat /proc/1/comm',phase);self.assertIn('unix_socket_directories=/tmp,/var/run/postgresql',phase)
if __name__=='__main__':unittest.main()
