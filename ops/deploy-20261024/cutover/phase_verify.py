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
  allowed=(app=='crm' and rel=='package.json') or (app=='booking' and rel in ['scripts/crm-worker.mts','scripts/notification-worker.mts'])
  require(not guarded or allowed,'Unreviewed operational/schema source difference.')
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
 elif mode=='image':
  rows=[r for r in read(sys.argv[2]) if service(r)==sys.argv[3]+':'+sys.argv[4]];require(len(rows)==1,'Service image ambiguity.');print(rows[0]['Image'])
 elif mode=='crm-release':
  p=pathlib.Path(sys.argv[2]);require(p.parent==pathlib.Path(sys.argv[3]) and p.name.startswith('crm-release-c27b8e3-'),'Unexpected CRM release.')
  for name in ['deployed-source.txt','deployed-image.txt','final-containers.private.json']:regular(p/name)
  require((p/'deployed-source.txt').read_text().strip()==PINS['crm']['commit'],'CRM receiver source not complete.')
  require(regular('/root/maxtravel-revamp-backup-9B5326/crm-current-cutover-path.txt').read_text().strip()==str(p),'CRM receiver pointer mismatch.')
 else:require(False,'Unknown verification mode.')
