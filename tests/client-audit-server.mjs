import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';

const root = process.cwd();
const port = 3212;
await new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(port, '127.0.0.1', () => socket.close(resolve));
});
const runtime = path.join(root, 'tests', '.runtime', `client-audit-${Date.now()}`);
mkdirSync(runtime, { recursive: true });
const env = { ...process.env, DATABASE_URL: `file:${path.join(runtime, 'test.db').replaceAll('\\', '/')}`, JWT_SECRET: randomBytes(32).toString('hex'), UPLOAD_ROOT: path.join(runtime, 'uploads') };
const fixture = { base: `http://127.0.0.1:${port}`, database: env.DATABASE_URL, uploadRoot: env.UPLOAD_ROOT, jwtSecret: env.JWT_SECRET, password: `Audit-${randomBytes(18).toString('hex')}!`, ownerEmail: 'owner@client-audit.test', runtime };
execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: root, env, stdio: 'pipe' });
const log = createWriteStream(path.join(runtime, 'server.log'));
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log); server.stderr.pipe(log);
writeFileSync(path.join(runtime, 'fixture.json'), JSON.stringify({ ...fixture, serverPid: server.pid }, null, 2));
writeFileSync(path.join(root, 'tests/.runtime/client-audit-current.json'), JSON.stringify({ runtime, fixture: path.join(runtime, 'fixture.json'), serverPid: server.pid }));
let ready = false;
for (let i = 0; i < 100; i++) {
  if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`);
  try { const r = await fetch(fixture.base + '/setup'); if (r.ok && (await r.text()).includes('Set up your agency')) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready) { server.kill(); throw new Error('Isolated server did not become ready'); }
console.log(`READY ${fixture.base} PID ${server.pid}; isolated runtime ${runtime}`);
server.on('exit', code => { console.log(`Server exited ${code}`); log.end(); process.exitCode = code ?? 1; });
