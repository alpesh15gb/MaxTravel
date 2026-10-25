"""Offline tests only: no Docker, database, provider or network access."""
import ast,pathlib,re,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parent
class BookingDraftTests(unittest.TestCase):
 def test_shell_and_embedded_python(self):
  for name in ('freeze-backup-verify-booking.sh','cutover-booking-app-only.sh'):
   p=ROOT/name;subprocess.run(['bash','-n',str(p)],check=True)
   bodies=re.findall(r"<<'(PY\w*)'\n(.*?)\n\1\n",p.read_text(),re.S)
   self.assertTrue(bodies)
   for tag,body in bodies:ast.parse(body,filename=name+':'+tag)
 def test_isolated_socket_contract(self):
  s=(ROOT/'freeze-backup-verify-booking.sh').read_text()
  self.assertIn('-e PGHOST=/tmp',s)
  self.assertIn('-c unix_socket_directories=/tmp',s)
  for line in s.splitlines():
   if 'docker exec' in line and '"$VERIFY"' in line and any(x in line for x in ('psql ','pg_dump ','pg_restore ')) and '--list' not in line:
    self.assertIn('-h /tmp',line)
 def test_only_app_up_and_frozen_paths(self):
  s=(ROOT/'cutover-booking-app-only.sh').read_text()
  commands=[l for l in s.splitlines() if ' up ' in l]
  self.assertEqual(len(commands),1);self.assertIn('--no-deps --no-build --pull never app',commands[0])
  self.assertIn('NEW=("${COMPOSE[@]}" -f "$RELEASE/candidate-image.yaml")',s)
  self.assertLess(s.index('touch "$BOOKING_BACKUP_STAGE/cutover-attempted.txt"'),s.index('"${NEW[@]}" up'))
  self.assertNotIn('pg_restore --clean',s)
 def test_failed_candidate_quiesce(self):
  s=(ROOT/'cutover-booking-app-only.sh').read_text()
  trap=next(line for line in s.splitlines() if line.startswith('trap '))
  self.assertIn('if [ "$CREATED" = 1 ]; then quiesce_candidate app',trap)
  self.assertNotIn('"$APP"',trap)
  self.assertLess(s.index('CREATED=1'),s.index('"${NEW[@]}" up'))
 def test_generated_resume_shell(self):
  s=(ROOT/'freeze-backup-verify-booking.sh').read_text()
  block=s[s.index('cat > "$STAGE/resume-old.sh"'):s.index('\nRESUME\n')+len('\nRESUME\n')]
  with tempfile.TemporaryDirectory() as d:
   variables='\n'.join(f'{k}={v}' for k,v in dict(STAGE=d,BUILD='/root/build',TARGET='a'*40,APP='a'*64,OLD_IMAGE='sha256:'+'b'*64,PG='c'*64,PG_IMAGE='sha256:'+'d'*64,VERIFY='isolated-helper').items())
   subprocess.run(['bash','-c',variables+'\n'+block],check=True)
   p=pathlib.Path(d)/'resume-old.sh';subprocess.run(['bash','-n',str(p)],check=True)
   self.assertIn('cutover-attempted.txt',p.read_text());self.assertIn('resumed-old.txt',p.read_text())
   self.assertIn('exec 9>/root/maxtravel-build-only.lock',p.read_text())
   self.assertLess(p.read_text().index('flock -n 9'),p.read_text().index('docker inspect'))
 def test_schema_token_normalization(self):
  s=(ROOT/'freeze-backup-verify-booking.sh').read_text()
  body=re.search(r"<<'PYSCHEMA'\n(.*?)\nPYSCHEMA",s,re.S).group(1)
  with tempfile.TemporaryDirectory() as d:
   a=pathlib.Path(d)/'a';b=pathlib.Path(d)/'b'
   a.write_text('\\restrict abc\nCREATE TABLE x();\n\\unrestrict abc\n')
   b.write_text('\\restrict def\nCREATE TABLE x();\n\\unrestrict def\n')
   self.assertEqual(subprocess.run(['python3','-c',body,str(a),str(b)],capture_output=True).returncode,0)
   b.write_text('CREATE TABLE y();\n')
   self.assertNotEqual(subprocess.run(['python3','-c',body,str(a),str(b)],capture_output=True).returncode,0)
if __name__=='__main__':unittest.main()
