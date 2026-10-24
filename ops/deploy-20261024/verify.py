#!/usr/bin/env python3
"""Offline validators; never contact Docker, a database, or a provider."""
import json, pathlib, sys, os, hashlib, re
PINS = {
 'crm': dict(repo='MaxTravel', commit='c27b8e352a9bdaf55f94df9fb3da1376f0f402d6', tree='3e5df6ecc245dbb40d02272cb257b203153ae123', baseline='2ecf81096489b0a74a953a692cee0e2642b3f769', image='sha256:ee8cb38694f9713b6f816d218b27e5276efe2e572bcb3ac026dea7a6f9f0d37d', release='/root/crm-build-2ecf810-ERht2Z/crm-release-2ecf810-IMh1AX', live='/opt/max-travel-crm', env='crm.env', files=['compose.vps.yaml','compose.evolution.yaml','image-override.yaml'], user='node'),
 'booking': dict(repo='MaxTripJack', commit='40b4988136c9708ca29a7f9340af52c53da37cc1', tree='197826e00a7b1b092035c3352912de86a3a6d081', baseline='fe14634d50568a2fb905e90ed22040557347f162', image='sha256:93b3669a105a5b2520e9ea59d57dde817affde74fa70cc736e43239e8b5fe220', release='/root/booking-build-fe14634-qbbdjR/booking-release-fe14634-ZJBWG3', live='/opt/max-travel-booking/booking-platform', env='compose.env', files=['compose.production.yaml','image-override.yaml'], user='travel'),
}
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
  require(r['State']['Running'] and r['RestartCount']==0,'Protected service stopped or restarted; fresh review required.')
  require(r['State'].get('Health',{}).get('Status') in (None,'healthy'),'Protected service unhealthy.')
  if service=='postgres':
   require(r['State'].get('Health',{}).get('Status')=='healthy','PostgreSQL healthcheck missing or unhealthy.')
   require(labels.get('com.docker.compose.project.working_dir')==p['live'],'PostgreSQL project directory differs.')
   continue
  require(r['Image']==p['image'],'Protected deployed image differs from historical pin.')
  require(labels.get('com.docker.compose.project.working_dir')==p['live'],'Project directory differs.')
  paths=labels.get('com.docker.compose.project.config_files','').split(',')
  expected=[p['release']+'/'+f for f in p['files']]
  require(paths in (expected,expected+[p['release']+'/candidate-image.yaml']),'Operative Compose sequence differs; review fresh paths.')
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
 if mode=='pin': print(PINS[sys.argv[2]][sys.argv[3]])
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
  require(pointer.read_text().strip()==p['release'],'Release pointer changed.')
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
