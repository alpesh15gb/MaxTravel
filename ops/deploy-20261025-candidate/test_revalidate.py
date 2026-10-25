import hashlib,io,json,pathlib,subprocess,tarfile,tempfile,unittest
import revalidate_stage as r
class RecoveryChecks(unittest.TestCase):
 def test_only_exact_stage_allowed(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(SystemExit):r.verify(pathlib.Path(d))
 def test_manifest_full_target_set_and_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);a=p/'a';b=p/'b';m=p/'hashes';a.write_text('original');b.write_text('other')
   m.write_text(r.digest(a)+'  '+str(a)+'\n');r.manifest(m,[a])
   with self.assertRaises(SystemExit):r.manifest(m,[a,b])
   a.write_text('changed')
   with self.assertRaises(SystemExit):r.manifest(m,[a])
 def test_manifest_duplicate_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);a=p/'a';m=p/'hashes';a.write_text('original');m.write_text((r.digest(a)+'  '+str(a)+'\n')*2)
   with self.assertRaises(SystemExit):r.manifest(m,[a])
 def archive(self,p):
  a=p/'source.tar';src=p/'source';src.mkdir();(src/'script.mjs').write_text('readable source');(src/'script.mjs').chmod(0o644)
  with tarfile.open(a,'w') as tar:tar.add(src/'script.mjs',arcname='script.mjs')
  return a,src
 def test_extracted_source_contents_and_inventory(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);a,src=self.archive(p);r.source_matches_archive(a,src)
   (src/'extra').write_text('unexpected')
   with self.assertRaises(SystemExit):r.source_matches_archive(a,src)
   (src/'extra').unlink();(src/'script.mjs').write_text('changed')
   with self.assertRaises(SystemExit):r.source_matches_archive(a,src)
 def test_source_symlink_and_modes_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);a,src=self.archive(p);(src/'script.mjs').chmod(0o600)
   with self.assertRaises(SystemExit):r.source_matches_archive(a,src)
   (src/'script.mjs').unlink();(p/'elsewhere').write_text('readable source');(src/'script.mjs').symlink_to(p/'elsewhere')
   with self.assertRaises(SystemExit):r.source_matches_archive(a,src)
 def test_revalidation_has_no_build_and_marker_last(self):
  s=(pathlib.Path(r.__file__).parent/'revalidate-built-crm.sh').read_text()
  self.assertNotIn('docker build',s);self.assertNotIn('docker compose up',s)
  marker=s.index("<<'PYVERIFIED'")
  for guard in ['final-artifact-id.txt','current-after.private.json','original-snapshots.sha256','source-tree.txt','runtime-env-paths.txt','remote-main.txt','PYREAD']:
   self.assertLess(s.rindex(guard,0,marker),marker)
  self.assertNotIn('> "$STAGE/before.private.json"',s);self.assertNotIn('> "$STAGE/after.private.json"',s)
 def test_final_recovery_marker_exact_contract(self):
  s=(pathlib.Path(r.__file__).parent/'revalidate-built-crm.sh').read_text();body=s.split("<<'PYVERIFIED'\n",1)[1].split('\nPYVERIFIED',1)[0]
  with tempfile.TemporaryDirectory() as d:
   args=['python3','-',d,'commit','tree','sha256:'+'a'*64]
   subprocess.run(args,input=body,text=True,check=True)
   value=json.loads((pathlib.Path(d)/'build-verified.json').read_text())
   self.assertEqual({k:value[k] for k in ['status','stage','app','commit','tree','image']},{'status':'verified','stage':d,'app':'crm','commit':'commit','tree':'tree','image':'sha256:'+'a'*64})
   result=subprocess.run(args,input=body,text=True,capture_output=True);self.assertNotEqual(result.returncode,0)
if __name__=='__main__':unittest.main()
