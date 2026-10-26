#!/usr/bin/env python3
"""Offline validators; never contact Docker, a database, or a provider."""
import json, pathlib, sys, os, hashlib, re
PINS = {
 'crm': dict(repo='MaxTravel', commit='f59810075a6935c28ea958a3b53e168284be687d', tree='90635d1db07dda36527999d737a637bddd11f4d1', baseline='0d0c72d24c320d56710f3c640a151b34697dc4e6', image='sha256:0cea593a8f8a2574be6e4f79d531b4e45079944f098ed110b8f1cf5541e812fd', release='/root/crm-build-2ecf810-ERht2Z/crm-release-2ecf810-IMh1AX', live='/opt/max-travel-crm', env='crm.env', files=['compose.vps.yaml','compose.evolution.yaml','image-override.yaml','candidate-image.yaml'], user='node'),
 'booking': dict(repo='MaxTripJack', commit='cc57b4bac4fe3ef0abbede150aab38d91448951a', tree='7f2e2ee47a19955b9c870c73e4ed6851d4e3a0eb', baseline='06615409f45c5ac9ef3b01b2538b26838ac0c69f', image='sha256:31874edd42ae52985b99a29739d9b57d2f6cc8f5c4e6ac79f0796c5b7e7344d1', release='/root/booking-build-fe14634-qbbdjR/booking-release-fe14634-ZJBWG3', live='/opt/max-travel-booking/booking-platform', env='compose.env', files=['compose.production.yaml','image-override.yaml','candidate-image.yaml'], user='travel'),
}
# User-confirmed completed baseline; each build must re-establish private evidence.
# Original release remains the interpolation/config base; pointer is the overlay.
PINS['crm']['pointer_release']='/root/crm-build-0d0c72d-fDcYXw/crm-release-0d0c72d-r02ds6'
PINS['crm']['overlays']=[
 '/root/crm-build-c27b8e3-p3drk2/crm-release-c27b8e3-2S4iPz/candidate-image.yaml',
 PINS['crm']['pointer_release']+'/candidate-image.yaml']
PINS['booking']['pointer_release']='/root/booking-build-0661540-wvdGUN/booking-release-0661540-nTBepa'
PINS['booking']['overlays']=[PINS['booking']['pointer_release']+'/candidate-image.yaml']
def compose_paths(app):
 p=PINS[app]
 return [p['release']+'/'+f for f in p['files']]+p['overlays']
# User supplied fresh four-service preflight at 2026-10-26 02:31 UTC.
BUILD_BASELINE_REVIEWED=True
EXPECTED_BASELINE_IDS={'crm:app':'d5e5f203357e113401ecadf7dcbc5d09e953925f61243b202e3c2f294af33007','crm:worker':'4c7264ef92004967821c271a03693183b9826b816fc7a8ad62f4856adc664a43','booking:app':'da49b4c8abd571a4238017c3ffc90babefd9d5bec6c1f6c31723c35a73052b06','booking:postgres':'df9fd0fdf66d26b56736a7d2f411e432d172ab9814a8fdb08fac40d81d04e465'}
EXPECTED_POSTGRES_IMAGE='sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168'
def candidate_build_gate():
 require(BUILD_BASELINE_REVIEWED and set(EXPECTED_BASELINE_IDS)=={'crm:app','crm:worker','booking:app','booking:postgres'}
         and all(re.fullmatch('[0-9a-f]{64}',value) for value in EXPECTED_BASELINE_IDS.values())
         and len(set(EXPECTED_BASELINE_IDS.values()))==4,
         'Build-only baseline not yet independently accepted; missing exact completed runtime identities.')
def check_baseline_rows(reference,current,expected_ids):
 # Import offline-only phase checks, preserving their full inventory/config guards.
 sys.path.insert(0,str(pathlib.Path(__file__).parent/'cutover'))
 from phase_verify import non_helper_rows,protected,service
 before=non_helper_rows(reference);after=non_helper_rows(current)
 for rows in (before,after):
  found=runtime(rows)
  actual={app+':'+name:r['Id'] for (app,name),r in found.items()}
  require(actual==expected_ids,'Completed baseline service identities differ; reconcile before build.')
 protected(before,after,'')
def build_baseline(path):
 candidate_build_gate()
 releases={app:pathlib.Path(PINS[app]['pointer_release']) for app in ('crm','booking')}
 for app in ('crm','booking'):
  expected={'deployed-source.txt':PINS[app]['baseline'],'deployed-image.txt':PINS[app]['image']}
  if app=='crm':expected['app-verified.txt']='verified'
  for name,value in expected.items():
   require(regular(releases[app]/name).read_text().strip()==value,'Completed '+app+' evidence missing or mismatched.')
  pointer=regular('/root/maxtravel-revamp-backup-9B5326/'+app+'-current-cutover-path.txt')
  require(pointer.read_text().strip()==PINS[app]['pointer_release'],'Completed baseline pointer differs.')
 # Booking completed after CRM. Its all-after snapshot is the authoritative full
 # inventory; the older CRM snapshot still contains the previous booking app.
 final=read(regular(releases['booking']/'all-after.private.json'))
 sys.path.insert(0,str(pathlib.Path(__file__).parent/'cutover'))
 from phase_verify import protected,non_helper_rows
 raw=read(regular(releases['booking']/'all-after.private.json.all.private.json'))
 protected(final,non_helper_rows(raw),'')
 for app,names in [('crm',('app','worker')),('booking',('app','postgres'))]:
  rows=read(regular(releases[app]/'final-containers.private.json'))
  ids={EXPECTED_BASELINE_IDS[app+':'+name] for name in names}
  require(len(rows)==len(ids) and {r['Id'] for r in rows}==ids,'Completed '+app+' final evidence identities differ.')
  protected(rows,[r for r in final if r['Id'] in ids],'')
  protected([r for r in final if r['Id'] in ids],rows,'')
  if app=='crm':
   crm_final=read(regular(releases[app]/'all-final.private.json'))
   protected(rows,[r for r in crm_final if r['Id'] in ids],'')
 current=read(path)
 # The previous failed helper is now pre-existing inventory. Preserve its exact
 # completed-booking record along with every other helper; never re-admit it.
 protected(raw,current,'')
 for rows in (final,current):
  postgres=[r for r in rows if r['Id']==EXPECTED_BASELINE_IDS['booking:postgres']]
  require(len(postgres)==1 and postgres[0]['Image']==EXPECTED_POSTGRES_IMAGE,'Confirmed PostgreSQL image differs.')
 check_baseline_rows(final,current,EXPECTED_BASELINE_IDS)
def candidate_execution_gate():
 # Phase-specific build, source, frozen-config, backup and isolated-restore gates remain mandatory.
 candidate_build_gate()
def require(ok, message):
 if not ok: raise SystemExit('STOP: '+message)
def read(p): return json.loads(pathlib.Path(p).read_text())
def regular(p):
 p=pathlib.Path(p)
 require(p.is_absolute() and p.is_file() and not any(x.is_symlink() for x in [p,*p.parents]), 'Missing or symlinked frozen file; review privately.')
 return p

# User-confirmed retained upgrade check, 2026-10-24 20:48 UTC. Not a generic
# stopped/one-off exemption: exact identity and successful exited state only.
RETAINED_CHECK_ID='cdd10ab33db2d17a04e1a861def28366dcc2ee60b54c55285a86b7071d87f33e'
RETAINED_CHECK_NAME='/max-travel-crm-upgrade-check-56e110ae'
def retained_upgrade_check(row):
 if row.get('Id')!=RETAINED_CHECK_ID and row.get('Name')!=RETAINED_CHECK_NAME: return False
 labels=row.get('Config',{}).get('Labels') or {}; state=row.get('State',{})
 require(row.get('Id')==RETAINED_CHECK_ID and row.get('Name')==RETAINED_CHECK_NAME
         and labels.get('com.docker.compose.project')=='max-travel-crm'
         and labels.get('com.docker.compose.service')=='app'
         and state.get('Status')=='exited' and state.get('ExitCode')==0
         and all(state.get(k) is False for k in ('Running','Paused','Restarting','Dead','OOMKilled')),
         'Retained upgrade-check identity/state changed; review before proceeding.')
 return True

def runtime(rows):
 found={}
 for r in rows:
  if retained_upgrade_check(r): continue
  labels=r.get('Config',{}).get('Labels') or {}; project=labels.get('com.docker.compose.project')
  if project not in ('max-travel-crm','max-travel-booking'): continue
  app='crm' if project=='max-travel-crm' else 'booking'; service=labels['com.docker.compose.service']; key=(app,service)
  require(key not in found,'Duplicate protected service.')
  found[key]=r; p=PINS[app]
  require(r['State']['Running'] and r['RestartCount']==0
          and all(r['State'].get(k) is False for k in ('Paused','Restarting','Dead','OOMKilled'))
          and r.get('HostConfig',{}).get('RestartPolicy')=={'Name':'unless-stopped','MaximumRetryCount':0},
          'Protected service lifecycle/restart policy differs; fresh review required.')
  require(r['State'].get('Health',{}).get('Status') in (None,'healthy'),'Protected service unhealthy.')
  if service=='postgres':
   require(r['State'].get('Health',{}).get('Status')=='healthy','PostgreSQL healthcheck missing or unhealthy.')
   require(labels.get('com.docker.compose.project.working_dir')==p['live'],'PostgreSQL project directory differs.')
   continue
  require(r['Image']==p['image'],'Protected deployed image differs from historical pin.')
  require(labels.get('com.docker.compose.project.working_dir')==p['live'],'Project directory differs.')
  paths=labels.get('com.docker.compose.project.config_files','').split(',')
  expected=compose_paths(app)
  require(paths==expected,'Operative Compose sequence differs; review fresh paths.')
 for app,names in [('crm',{'app','worker'}),('booking',{'app','postgres'})]:
  require({s for a,s in found if a==app}==names,'Running/stopped service inventory differs from historical app-only plan.')
  require(found[(app,'app')]['State'].get('Health',{}).get('Status')=='healthy','App healthcheck missing or unhealthy.')
 return found

def env_map(values):
 result={}
 for value in values or []:
  key,sep,val=value.partition('=')
  require(bool(key) and key not in result,'Duplicate or invalid environment key; inspect privately.')
  result[key]=val if sep else None
 return result

def effective_environment(image, service):
 # Image defaults remain unless Compose explicitly overrides or unsets a key.
 expected=env_map(image['Config'].get('Env'))
 for key,value in service.get('environment',{}).items():
  if value is None: expected.pop(key,None)
  else: expected[key]=str(value)
 return expected

def environment_matches(container, image, service):
 require(effective_environment(image,service)==env_map(container['Config'].get('Env')),
         'Full frozen/image environment does not match runtime; inspect privately.')

def canonical_mounts(mounts):
 # Only top-level Mounts order is presentation-only. Keep complete records,
 # duplicate multiplicity, value types, nested arrays, and every unknown field.
 require(isinstance(mounts,list) and all(isinstance(m,dict) for m in mounts),'Malformed mount inspection.')
 return sorted(json.dumps(m,sort_keys=True,separators=(',',':')) for m in mounts)

def main():
 mode=sys.argv[1]
 if mode=='candidate-execution-gate': candidate_execution_gate()
 elif mode=='candidate-build-gate': candidate_build_gate()
 elif mode=='build-baseline': build_baseline(sys.argv[2])
 elif mode=='pin': print(PINS[sys.argv[2]][sys.argv[3]])
 elif mode=='runtime': runtime(read(sys.argv[2]))
 elif mode=='after':
  before={r['Id']:r for r in read(sys.argv[2])}; after={r['Id']:r for r in read(sys.argv[3])}
  require(before.keys()==after.keys(),'Container inventory changed during build.')
  for id,r in before.items():
   n=after[id]
   require(all(r.get(k)==n.get(k) for k in ['Name','Image','RestartCount','Config','HostConfig']),'Container configuration or restart count changed.')
   require(canonical_mounts(r.get('Mounts'))==canonical_mounts(n.get('Mounts')),'Container mount configuration changed.')
   for key in ('StartedAt','FinishedAt','Paused','Restarting','Dead','OOMKilled','Running','Status','ExitCode'):
    require(r['State'].get(key)==n['State'].get(key),'Container lifecycle state changed.')
   if r['State'].get('Health',{}).get('Status')=='healthy': require(n['State'].get('Health',{}).get('Status')=='healthy','Previously healthy container became unhealthy.')
 elif mode=='paths':
  app=sys.argv[2]; rows=runtime(read(sys.argv[3])); p=PINS[app]
  pointer=regular('/root/maxtravel-revamp-backup-9B5326/'+app+'-current-cutover-path.txt')
  require(pointer.read_text().strip()==p['pointer_release'],'Release pointer changed.')
  for f in rows[(app,'app')]['Config']['Labels']['com.docker.compose.project.config_files'].split(','): print(regular(f))
 elif mode=='config':
  app=sys.argv[2]; config=read(sys.argv[3]); unresolved=read(sys.argv[4]); rows=runtime(read(sys.argv[5])); p=PINS[app]
  images={image['Id']:image for image in read(sys.argv[6])}
  for (kind,name),r in rows.items():
   if kind!=app: continue
   service=config['services'][name]
   require(service['image'] in (r['Image'],r['Config']['Image']),'Compose image does not match deployed runtime.')
   require(r['Image'] in images,'Required deployed image defaults missing.')
   environment_matches(r,images[r['Image']],service)
  paths=set()
  for s in unresolved['services'].values():
   for item in s.get('env_file',[]):
    path=item if isinstance(item,str) else item['path']; f=regular(path)
    require(str(f).startswith('/root/'),'Runtime env reference outside private release area.')
    paths.add(str(f))
  if app=='booking':
   app_paths=[v if isinstance(v,str) else v['path'] for v in unresolved['services']['app'].get('env_file',[])]
   require(len(app_paths)==1 and pathlib.Path(app_paths[0]).name=='runtime.env','Booking frozen runtime dependency differs.')
  for f in sorted(paths): print(f)
 elif mode=='source':
  for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
   metadata,name=line.split('\t',1); filemode,kind,_=metadata.split(); p=pathlib.PurePosixPath(name)
   require(kind=='blob' and filemode in ('100644','100755'),'Symlink or submodule in source: review before extraction.')
   require(not ((p.name.startswith('.env') and p.name not in ('.env.example','.env.migration.example')) or p.suffix in ('.pem','.key','.db','.dump')),'Tracked secret/data-like filename; inspect privately.')
 elif mode=='builder':
  # buildx inspect has NO portable --format option. Parse its stable human-readable fields, fail closed.
  text=pathlib.Path(sys.argv[2]).read_text(); rows=read(sys.argv[3]); builder=sys.argv[4]
  names=re.findall(r'^Name:\s+(\S+)\s*$',text,re.M)
  require(len(names)==2 and names[0]==builder,'Expected a single-node named builder.')
  require(re.search(r'^Driver:\s+docker-container\s*$',text,re.M),'A pre-existing capped docker-container builder is required.')
  endpoints=re.findall(r'^Endpoint:\s+(\S+)\s*$',text,re.M)
  require(endpoints==['unix:///var/run/docker.sock'],'Builder endpoint is not the local default socket.')
  require(len(rows)==1 and rows[0]['Name']=='/buildx_buildkit_'+names[1],'Builder container does not match node.')
  r=rows[0]; h=r['HostConfig']
  require(r['State']['Running'],'Builder must already be running; no bootstrap allowed.')
  require(0<h.get('Memory',0)<=6*1024**3 and 0<h.get('MemorySwap',0)<=8*1024**3,'Builder memory/swap caps missing or exceed 6/8 GiB.')
  cpu=h.get('NanoCpus',0)/1e9 or (h.get('CpuQuota',0)/h.get('CpuPeriod',0) if h.get('CpuPeriod',0)>0 else 0)
  require(0<cpu<=2,'Builder CPU cap missing or exceeds two cores.')
 else: raise SystemExit('Unknown validator mode')
if __name__=='__main__': main()
