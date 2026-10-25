#!/usr/bin/env python3
"""Offline-only, fail-closed phase validation. Errors never print secret values."""
import sys,json,pathlib,re,subprocess
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from verify import PINS,require,read,regular,runtime,retained_upgrade_check,canonical_mounts

def non_helper_rows(rows):
 require(isinstance(rows,list) and all(isinstance(r,dict) for r in rows),'Invalid container inventory.')
 kept=[r for r in rows if ((r.get('Config') or {}).get('Labels') or {}).get('maxtravel.cutover.helper')!='true']
 require(bool(kept),'Empty protected container inventory.')
 return kept

def service(r):
 if retained_upgrade_check(r):return 'retained:'+r['Id']
 l=r.get('Config',{}).get('Labels') or {}
 return l.get('com.docker.compose.project','').removeprefix('max-travel-')+':'+l.get('com.docker.compose.service','')
def stage(app,path):
 p=pathlib.Path(path); pin=PINS[app]
 require(p.is_absolute() and re.fullmatch('/root/'+app+'-build-'+pin['commit'][:7]+'-[A-Za-z0-9]+',str(p)) is not None,'Unexpected build path.')
 for name in ['build-verified.json','before.private.json','source-commit.txt','source-tree-id.txt','candidate-image-id.txt','candidate-image.private.json','after.private.json','non-root-readability.private.json','frozen-originals.sha256','compose-paths.txt']:
  regular(p/name)
 require((p/'source-commit.txt').read_text().strip()==pin['commit'],'Build commit mismatch.')
 require((p/'source-tree-id.txt').read_text().strip()==pin['tree'],'Build tree mismatch.')
 image=(p/'candidate-image-id.txt').read_text().strip()
 require(bool(re.fullmatch('sha256:[0-9a-f]{64}',image)),'Malformed candidate image.')
 require(read(p/'candidate-image.private.json')[0]['Id']==image,'Candidate metadata mismatch.')
 marker=read(p/'build-verified.json')
 require(all(marker.get(k)==value for k,value in dict(status='verified',stage=str(p),app=app,commit=pin['commit'],tree=pin['tree'],image=image).items()),'Final build success marker missing or mismatched.')
 require(read(p/'non-root-readability.private.json').get('readability')=='passed','Non-root readability not verified.')
 for f in (p/'compose-paths.txt').read_text().splitlines(): regular(f)
 runtime(read(p/'before.private.json'))
 protected(read(p/'before.private.json'),read(p/'after.private.json'),'')

def protected(before,after,allowed):
 allow=set(filter(None,allowed.split(',')))
 for rows in (before,after):
  require(len({r['Id'] for r in rows})==len(rows),'Duplicate container IDs in evidence.')
  for key in allow:require(sum(service(r)==key for r in rows)==1,'Allowed service count changed; expected exactly one canonical container.')
 a={r['Id']:r for r in before if service(r) not in allow};b={r['Id']:r for r in after if service(r) not in allow}
 require(a.keys()==b.keys(),'Protected container inventory differs.')
 for id,r in a.items():
  n=b[id]
  require(all(r.get(k)==n.get(k) for k in ['Name','Image','RestartCount','Config','HostConfig']),'Protected configuration changed.')
  require(canonical_mounts(r['Mounts'])==canonical_mounts(n['Mounts']),'Protected mounts changed.')
  require(set(r['NetworkSettings']['Networks'])==set(n['NetworkSettings']['Networks']),'Protected networks changed.')
  for k in ['StartedAt','FinishedAt','Paused','Restarting','Dead','OOMKilled','Running']:
   require(r['State'].get(k)==n['State'].get(k),'Protected lifecycle changed.')
  if r['State'].get('Health',{}).get('Status')=='healthy':require(n['State'].get('Health',{}).get('Status')=='healthy','Protected health changed.')
def completed_peer_helpers(release):
 r=pathlib.Path(release);stage=pathlib.Path(regular(r/"snapshot-stage.txt").read_text().strip())
 require(stage.parent==r.parent and stage.name.startswith("final-backup-"),"Unexpected peer backup evidence path.")
 require(regular(stage/"restore-verified.txt").read_text().strip()=="verified","Peer isolated restore not verified.")
 names=regular(stage/"helper-names.txt").read_text().splitlines()
 require(len(names)==2 and len(set(names))==2 and all(names),"Peer backup helper identities ambiguous.")
 raw=read(regular(r/"all-final.private.json.all.private.json"))
 require(len({x["Id"] for x in raw})==len(raw),"Duplicate peer final raw IDs.")
 rows=[]
 for name in names:
  found=[x for x in raw if x.get("Name")=="/"+name]
  require(len(found)==1 and ((found[0].get("Config") or {}).get("Labels") or {}).get("maxtravel.cutover.helper")=="true","Peer final helper evidence mismatch.")
  rows.append(found[0])
 require(rows[0]["Image"]==PINS["crm"]["image"] and rows[1]["Image"]==regular(r/"deployed-image.txt").read_text().strip(),"Peer backup/restore helper image mismatch.")
 return rows
FAILED_BOOKING_STAGE='/root/booking-build-0661540-wvdGUN/final-backup-sQr9dj'
FAILED_POSTGRES_IMAGE='sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168'
def failed_booking_helper(stage,current_raw):
 p=pathlib.Path(stage);require(str(p)==FAILED_BOOKING_STAGE,'Unknown failed booking stage.')
 for name in ['stop-app.log','database.dump','audit.sql','resume-old.sh','restore-verified.txt','cutover-attempted.txt','resumed-old.txt']:
  f=p/name;require(not f.exists() and not f.is_symlink(),'Failed stage progressed beyond pre-freeze startup; reconcile.')
 cid=regular(p/'isolated-container-id.txt').read_text().strip();require(bool(re.fullmatch('[0-9a-f]{64}',cid)),'Invalid failed helper identity.')
 rows=[r for r in current_raw if r['Id']==cid];require(len(rows)==1,'Exact failed helper missing/ambiguous.')
 r=rows[0];state=r['State'];host=r['HostConfig'];config=r['Config']
 require(r.get('Name')=='/booking-restore-final-backup-sqr9dj' and r['Image']==FAILED_POSTGRES_IMAGE,'Failed helper name/image mismatch.')
 require((config.get('Labels') or {}).get('maxtravel.cutover.helper')=='true' and not any(k.startswith('com.docker.compose.') for k in (config.get('Labels') or {})),'Failed helper labels mismatch.')
 require(state.get('Status')=='exited' and type(state.get('ExitCode')) is int and 0<=state['ExitCode']<=255
         and all(state.get(k) is False for k in ('Running','Paused','Restarting','Dead','OOMKilled')),'Failed helper must remain stopped and non-OOM.')
 require(host.get('NetworkMode')=='none' and host.get('ReadonlyRootfs') is True and host.get('Privileged') is False
         and host.get('CapDrop')==['ALL'] and host.get('SecurityOpt')==['no-new-privileges']
         and host.get('Memory')==1073741824 and host.get('NanoCpus')==1000000000 and host.get('PidsLimit')==256
         and host.get('RestartPolicy')=={'Name':'no','MaximumRetryCount':0},'Failed helper isolation/resources mismatch.')
 require(bool(re.fullmatch('[1-9][0-9]*:[1-9][0-9]*',config.get('User',''))) and config.get('Cmd')==['-c','listen_addresses=','-c','unix_socket_directories=/tmp'],'Failed helper user/command mismatch.')
 mounts=r.get('Mounts',[]);destinations=[m.get('Destination') for m in mounts]
 # Docker versions may expose --tmpfs only in HostConfig.Tmpfs, not Mounts.
 # Exact Tmpfs is checked below; bind inventory remains mandatory and exclusive.
 require(len(set(destinations))==len(destinations) and '/var/lib/postgresql/data' in destinations and set(destinations)<={'/tmp','/var/run/postgresql','/var/lib/postgresql/data'},'Failed helper mount inventory differs.')
 for m in mounts:
  if m['Destination']=='/var/lib/postgresql/data':require(m.get('Type')=='bind' and m.get('Source')==str(p/'isolated-data') and m.get('RW') is True,'Failed helper data mount differs.')
  else:require(m.get('Type')=='tmpfs' and m.get('RW') is True,'Failed helper scratch mount differs.')
 require(host.get('Tmpfs')=={'/tmp':'rw,nosuid,nodev,mode=1777','/var/run/postgresql':'rw,nosuid,nodev,mode=1777'},'Failed helper tmpfs configuration differs.')
 images=read(regular(p.parent/'deployed-images.private.json'));matches=[x for x in images if x['Id']==FAILED_POSTGRES_IMAGE];require(len(matches)==1,'Failed helper image defaults unavailable.')
 image=matches[0];expected_env=dict(x.split('=',1) for x in image['Config'].get('Env',[]));expected_env.update({'PGHOST':'/tmp','POSTGRES_USER':'maxtravel','POSTGRES_DB':'maxtravel','POSTGRES_HOST_AUTH_METHOD':'trust'})
 env=dict(x.split('=',1) for x in config.get('Env',[]) if '=' in x)
 require(len(env)==len(config.get('Env',[])) and env==expected_env and config.get('Entrypoint')==image['Config'].get('Entrypoint'),'Failed helper full image environment/entrypoint differs.')
 protected(read(regular(p/'all-before.private.json')),non_helper_rows(current_raw),'')
 return r
def retained_helper_unchanged(record,current_raw):
 rows=read(regular(record));require(isinstance(rows,list) and len(rows)==1,'Retained helper record malformed.')
 current=[r for r in current_raw if r['Id']==rows[0]['Id']]
 protected(rows,current,'')
def protected_build(before,current_raw,allowed,peer_helpers=None,retained=None):
 for rows in (before,current_raw):
  require(len({r['Id'] for r in rows})==len(rows),'Duplicate raw container IDs in build-to-freeze evidence.')
 # Build evidence is intentionally raw; phase snapshots also retain raw evidence.
 # Apply the EXISTING exact helper=true projection symmetrically, then additionally
 # preserve every pre-existing helper's full identity/configuration/lifecycle.
 protected(non_helper_rows(before),non_helper_rows(current_raw),allowed)
 old_helpers=[r for r in before if ((r.get('Config') or {}).get('Labels') or {}).get('maxtravel.cutover.helper')=='true']
 old_ids={r['Id'] for r in old_helpers}
 current_helpers=[r for r in current_raw if r['Id'] in old_ids]
 require({r['Id'] for r in current_helpers}==old_ids,'Pre-existing build helper disappeared; reconcile without cleanup.')
 protected(old_helpers,current_helpers,'')
 before_ids={r['Id'] for r in before};allowed_services=set(filter(None,allowed.split(',')))
 retained=retained or []
 require(not retained or (len(retained)==1 and allowed_services=={'crm:app','crm:worker'}),'Retained incident helper only allowed for booking.')
 peer_helpers=(peer_helpers or [])+retained
 require(len({r['Id'] for r in peer_helpers})==len(peer_helpers),'Duplicate peer helper identities.')
 require(not peer_helpers or allowed_services=={'crm:app','crm:worker'},'New helper admission is only valid after completed CRM peer cutover.')
 require(all(r['Id'] not in before_ids for r in peer_helpers),'Peer helper is not newly created since build.')
 expected_new_ids={r['Id'] for r in peer_helpers}
 new_helpers=[r for r in current_raw if r['Id'] not in before_ids and ((r.get('Config') or {}).get('Labels') or {}).get('maxtravel.cutover.helper')=='true']
 require({r['Id'] for r in new_helpers}==expected_new_ids,'New helper inventory differs from exact completed peer backup evidence.')
 protected(peer_helpers,new_helpers,'')
 for r in current_raw:
  is_helper=((r.get('Config') or {}).get('Labels') or {}).get('maxtravel.cutover.helper')=='true'
  if r['Id'] in before_ids or r['Id'] in {x['Id'] for x in retained} or (not is_helper and service(r) in allowed_services):continue
  # New helper records can appear between a build and the peer's completed
  # backup phase. Never admit running, failed, privileged or networked helpers.
  labels=(r.get('Config') or {}).get('Labels') or {};state=r.get('State') or {};host=r.get('HostConfig') or {}
  require(labels.get('maxtravel.cutover.helper')=='true'
          and state.get('Status')=='exited' and state.get('ExitCode')==0
          and all(state.get(k) is False for k in ('Running','Paused','Restarting','Dead','OOMKilled'))
          and host.get('NetworkMode')=='none' and host.get('ReadonlyRootfs') is True
          and host.get('Privileged') is False and host.get('CapDrop')==['ALL']
          and host.get('SecurityOpt')==['no-new-privileges']
          and (r.get('Config') or {}).get('User')=='1000:1000',
          'Unexpected new container; only completed isolated non-root phase helpers qualify.')
BOOKING_OPERATIONAL_SHA256={'package.json': 'fc3c4e4b8b2fe66fbcce8c33aad73b82d5687fb32f0f021c721195e4b37df8e1', 'package-lock.json': '4f1b04c484bd9129f2124c3b1f1d62d60437c39739145eed17ffd5a0501cc417', 'scripts/verify-seo-http.mjs': '0913aad71525dd7c7ae2040a78f22d5e3ab561c0b4c41b483f41bdecf55fa2ab', 'scripts/crm-worker.mts': '91daca103095781e5929d3f46d5fff7e99ae35416a1d28786bfd22ad17ff8b3d', 'scripts/notification-worker.mts': '49f924954f8485d9c67dc5a622c43d05f9a937682db5c93d353fc2f9648330fc'}
def exact_booking_operational_bytes(rel,data):
 import hashlib
 require(rel in BOOKING_OPERATIONAL_SHA256 and hashlib.sha256(data).hexdigest()==BOOKING_OPERATIONAL_SHA256[rel],
         "Booking operational file differs from exactly reviewed target bytes.")
def source(app,path):
 p=PINS[app];git=['git','-C',str(pathlib.Path(path)/'git')]
 def run(*args):return subprocess.check_output(git+list(args),text=True)
 require(run('rev-parse',p['commit']+'^{tree}').strip()==p['tree'],'Git tree differs.')
 changed=run('diff','--name-only',p['baseline'],p['commit']).splitlines()
 prefix='' if app=='crm' else 'booking-platform/'
 for f in changed:
  if not f.startswith(prefix):continue
  rel=f[len(prefix):]
  guarded=rel.startswith(('prisma/','db/','scripts/','compose')) or rel in ['Dockerfile','.dockerignore','package.json','package-lock.json','next.config.mjs']
  allowed=(app=='crm' and rel=='package.json') or (app=='booking' and rel in BOOKING_OPERATIONAL_SHA256)
  require(not guarded or allowed,'Unreviewed operational/schema source difference.')
  if app=='booking' and guarded and allowed:
   exact_booking_operational_bytes(rel,(pathlib.Path(path)/'source'/rel).read_bytes())
 if app=='crm':
  import hashlib
  expected={'docker-entrypoint.sh': 'cf34b79a8e7e23cbe376555c4bb4c5ec29a4ce2a08aea9a8fe468a9b35124f5a', 'backup.mjs': '7586e52b3740116a435e75c69731dc66bb64a9a060d52d43276130586bdf86c5', 'restore.mjs': '34333d2e9dc2e300f9ef78f90fea662a39ff60437bcd907b32d12bdb1336956f'}
  for name,digest in expected.items():require(hashlib.sha256((pathlib.Path(path)/'source/scripts'/name).read_bytes()).hexdigest()==digest,'CRM pinned operational helper differs.')
  old=json.loads(run('show',p['baseline']+':package.json'));new=json.loads(run('show',p['commit']+':package.json'))
  a=old.pop('scripts');b=new.pop('scripts');require(old==new,'CRM runtime dependency drift.')
  require(all(a.get(k)==b.get(k) for k in set(a)|set(b) if not (k=='test' or k.startswith('test:'))),'CRM non-test command drift.')
def runtime_equal(before,after,app):
 require(len({service(r) for r in before})==len(before) and len({service(r) for r in after})==len(after),'Duplicate service in runtime evidence.')
 old={service(r):r for r in before};new={service(r):r for r in after}
 require(old.keys()==new.keys(),'Runtime service membership changed.')
 for key,a in old.items():
  b=new[key]
  require(a['HostConfig']==b['HostConfig'],'Full HostConfig/security/resources changed.')
  require(canonical_mounts(a['Mounts'])==canonical_mounts(b['Mounts']),'Full mounts changed.')
  require(set(a['NetworkSettings']['Networks'])==set(b['NetworkSettings']['Networks']),'Network identities changed.')
  x=json.loads(json.dumps(a['Config']));y=json.loads(json.dumps(b['Config']))
  require(x.get('Hostname')==y.get('Hostname') or (x.get('Hostname')==a['Id'][:12] and y.get('Hostname')==b['Id'][:12]),'Explicit hostname changed.')
  replacement=(y.get('Labels') or {}).get('com.docker.compose.replace')
  if a['Id']==b['Id']:
   require(replacement==(x.get('Labels') or {}).get('com.docker.compose.replace'),'Unchanged-container replacement label drift.')
  else:
   labels_a=a['Config'].get('Labels') or {};labels_b=b['Config'].get('Labels') or {}
   project=labels_a.get('com.docker.compose.project');svc=labels_a.get('com.docker.compose.service');number=labels_a.get('com.docker.compose.container-number')
   relative=(svc+'-'+number) if isinstance(svc,str) and isinstance(number,str) and re.fullmatch(r'[1-9][0-9]*',number) else None
   canonical=('/'+project+'-'+relative) if isinstance(project,str) and relative else None
   modern=bool(relative and replacement==relative and a.get('Name')==canonical and b.get('Name')==canonical and all(labels_a.get(k)==labels_b.get(k) for k in ('com.docker.compose.project','com.docker.compose.service','com.docker.compose.container-number')))
   require(replacement is None or replacement==a['Id'] or modern,'Unrecognized Compose replacement identity.')
  (y.get('Labels') or {}).pop('com.docker.compose.replace',None)
  (x.get('Labels') or {}).pop('com.docker.compose.replace',None)
  for obj in (x,y):
   obj.pop('Hostname',None);obj.pop('Image',None)
   for label in ['com.docker.compose.config-hash','com.docker.compose.image','com.docker.compose.project.config_files','org.opencontainers.image.revision','org.opencontainers.image.source-tree']:
    (obj.get('Labels') or {}).pop(label,None)
  def env(o):return dict(z.split('=',1) for z in o['Env'])
  ex=env(x);ey=env(y)
  if app=='crm' and key=='crm:app':ex['RUN_MIGRATIONS']='false'
  require(ex==ey,'Full runtime environment changed.')
  x.pop('Env');y.pop('Env')
  require(x==y,'Full runtime config changed beyond reviewed image metadata/migration skip.')
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='snapshot-filter':json.dump(non_helper_rows(read(sys.argv[2])),sys.stdout)
 elif mode=='stage':stage(*sys.argv[2:])
 elif mode=='runtime-equal':runtime_equal(read(sys.argv[2]),read(sys.argv[3]),sys.argv[4])
 elif mode=='source':source(*sys.argv[2:])
 elif mode=='protected':protected(read(sys.argv[2]),read(sys.argv[3]),sys.argv[4])
 elif mode=='protected-build':
  current=read(sys.argv[3]);retained=[]
  if len(sys.argv)>6 and sys.argv[6]:retained=[failed_booking_helper(sys.argv[6],current)]
  protected_build(read(sys.argv[2]),current,sys.argv[4],completed_peer_helpers(sys.argv[5]) if len(sys.argv)>5 and sys.argv[5] else None,retained)
  if retained:
   output=pathlib.Path(sys.argv[7]);require(output.name=='retained-failed-helper.private.json' and output.parent.name.startswith('final-backup-') and output.parent.parent==pathlib.Path(FAILED_BOOKING_STAGE).parent and output.parent!=pathlib.Path(FAILED_BOOKING_STAGE),'Unexpected retained evidence destination.')
   with output.open('x') as f:json.dump(retained,f,sort_keys=True);f.write('\n')
 elif mode=='retained-helper':retained_helper_unchanged(sys.argv[2],read(sys.argv[3]))
 elif mode=='image':
  rows=[r for r in read(sys.argv[2]) if service(r)==sys.argv[3]+':'+sys.argv[4]];require(len(rows)==1,'Service image ambiguity.');print(rows[0]['Image'])
 elif mode=='crm-release':
  p=pathlib.Path(sys.argv[2]);require(p.parent==pathlib.Path(sys.argv[3]) and p.name.startswith('crm-release-'+PINS['crm']['commit'][:7]+'-'),'Unexpected CRM release.')
  for name in ['deployed-source.txt','deployed-image.txt','final-containers.private.json']:regular(p/name)
  require((p/'deployed-source.txt').read_text().strip()==PINS['crm']['commit'],'CRM receiver source not complete.')
  require(regular('/root/maxtravel-revamp-backup-9B5326/crm-current-cutover-path.txt').read_text().strip()==str(p),'CRM receiver pointer mismatch.')
 else:require(False,'Unknown verification mode.')
