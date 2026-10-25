#!/usr/bin/env python3
"""Offline artifact proof for exactly the user-reported completed CRM build."""
import hashlib,json,pathlib,re,subprocess,sys,tarfile
from verify import PINS,read,regular,require
STAGE=pathlib.Path('/root/crm-build-c27b8e3-p3drk2')
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
 return h.hexdigest()
def manifest(path,expected):
 regular(path);entries={}
 for line in path.read_text().splitlines():
  match=re.fullmatch(r'([0-9a-f]{64})  (/.+)',line)
  require(match is not None,'Malformed preserved checksum manifest.')
  value,name=match.groups();require(name not in entries,'Duplicate checksum target.');entries[name]=value
 require(set(entries)=={str(p) for p in expected},'Checksum target inventory differs.')
 for name,value in entries.items():require(digest(regular(name))==value,'Preserved checksum failed; inspect privately.')
def source_matches_archive(archive,source):
 files={}
 with tarfile.open(archive,'r:') as tar:
  for item in tar:
   path=pathlib.PurePosixPath(item.name)
   require(not path.is_absolute() and '..' not in path.parts,'Unsafe source archive path.')
   if item.isdir():continue
   require(item.isfile() and item.name not in files,'Unexpected source archive member.')
   actual=regular(source/item.name)
   stream=tar.extractfile(item);h=hashlib.sha256()
   for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
   require(digest(actual)==h.hexdigest(),'Extracted source content differs from pinned archive.')
   require(actual.stat().st_mode & 0o444 == 0o444,'Source files are not non-root readable.')
   files[item.name]=True
 actual=set()
 for p in source.rglob('*'):
  require(not p.is_symlink(),'Symlink in extracted source.')
  if p.is_file():actual.add(str(p.relative_to(source)))
  else:require(p.is_dir(),'Unexpected extracted source type.')
 require(actual==set(files),'Extracted source file inventory differs.')
def verify(stage):
 require(stage==STAGE and stage.is_dir() and not any(p.is_symlink() for p in [stage,*stage.parents]),'Unreviewed recovery stage.')
 require(not (stage/'build-verified.json').exists(),'Stage already marked verified; do not rerun recovery.')
 pin=PINS['crm']
 needed=['source-commit.txt','source-tree-id.txt','candidate-image-id.txt','candidate-image-tag.txt','candidate-image.private.json','before.private.json','after.private.json','non-root-readability.private.json','resolved.private.json','unresolved.private.json','deployed-images.private.json','rollback-image.private.json','compose-paths.txt','runtime-env-paths.txt','frozen-paths.txt','source-tree.txt','reviewed-source-diff.txt']
 for name in needed:regular(stage/name)
 require((stage/'source-commit.txt').read_text().strip()==pin['commit'] and (stage/'source-tree-id.txt').read_text().strip()==pin['tree'],'Original source identity differs.')
 image=(stage/'candidate-image-id.txt').read_text().strip();require(re.fullmatch('sha256:[0-9a-f]{64}',image) is not None,'Invalid original candidate ID.')
 info=read(stage/'candidate-image.private.json');require(len(info)==1 and info[0]['Id']==image,'Original candidate metadata differs.')
 labels=info[0]['Config'].get('Labels') or {}
 require(labels.get('org.opencontainers.image.revision')==pin['commit'] and labels.get('org.opencontainers.image.source-tree')==pin['tree'] and info[0]['Config'].get('User')=='node','Original candidate pins/user differ.')
 require(read(stage/'non-root-readability.private.json').get('readability')=='passed' and read(stage/'non-root-readability.private.json').get('uid')==1000,'Original readability evidence missing or wrong UID.')
 rollback=read(stage/'rollback-image.private.json');require(len(rollback)==1 and rollback[0]['Id']==pin['image'],'Rollback metadata differs.')
 paths=(stage/'frozen-paths.txt').read_text().splitlines();require(paths and len(paths)==len(set(paths)),'Invalid frozen path inventory.')
 compose=(stage/'compose-paths.txt').read_text().splitlines();envs=(stage/'runtime-env-paths.txt').read_text().splitlines()
 expected=set(compose+envs+[pin['release']+'/'+pin['env'],'/root/maxtravel-revamp-backup-9B5326/crm-current-cutover-path.txt'])
 require(set(paths)==expected,'Frozen dependency inventory differs.')
 manifest(stage/'frozen-originals.sha256',paths)
 for path in paths:require(digest(regular(stage/'preserved'/path.lstrip('/')))==digest(regular(path)),'Preserved dependency copy differs.')
 manifest(stage/'source-archive.sha256',[stage/'source.tar']);manifest(stage/'rollback-image.sha256',[stage/'rollback-image.tar'])
 git=['git','-C',str(stage/'git')]
 def output(*args):return subprocess.check_output(git+list(args))
 require(output('rev-parse',pin['commit']+'^{tree}').decode().strip()==pin['tree'],'Isolated source tree differs.')
 require(output('rev-parse','FETCH_HEAD').decode().strip()==pin['commit'],'Original fetched head differs.')
 subprocess.run(git+['merge-base','--is-ancestor',pin['baseline'],pin['commit']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 require(output('ls-tree','-r',pin['commit'])==(stage/'source-tree.txt').read_bytes(),'Source listing differs.')
 require(output('diff','--name-status',pin['baseline'],pin['commit'])==(stage/'reviewed-source-diff.txt').read_bytes(),'Source diff listing differs.')
 require(hashlib.sha256(output('archive','--format=tar',pin['commit'])).hexdigest()==digest(stage/'source.tar'),'Archive differs from exact Git source.')
 source_matches_archive(stage/'source.tar',stage/'source')
 return image
if __name__=='__main__':print(verify(pathlib.Path(sys.argv[1])))
