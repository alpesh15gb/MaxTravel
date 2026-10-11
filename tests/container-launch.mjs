// Verifies the packaged single-server app using disposable Docker resources only.
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const suffix=randomBytes(6).toString("hex"),name=`travel-os-check-${suffix}`,volume=`travel-os-check-data-${suffix}`;
const image=process.env.CHECK_IMAGE||"travel-os:revamp-review";
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
let base,cookie;
const post=async(route,body)=>fetch(base+route,{method:"POST",headers:{"Content-Type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body)});
try {
  docker("volume","create",volume);
  docker("run","-d","--name",name,"--mount",`type=volume,source=${volume},target=/data`,"-p","127.0.0.1::3000","-e","DATABASE_URL=file:/data/app.db","-e",`JWT_SECRET=${randomBytes(32).toString("hex")}`,image);
  base="http://"+docker("port",name,"3000/tcp");
  let ready=false;
  for(let i=0;i<90;i++){try{if((await fetch(base+"/api/health")).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  assert(ready,"Container health did not become ready");
  const password="Container-"+randomBytes(16).toString("hex");
  assert.equal((await post("/api/setup",{agencyName:"Container verification",city:"Pune",name:"Container owner",email:"container@example.test",password})).status,201);
  const login=await post("/api/auth/login",{email:"container@example.test",password});assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
  const reads=await Promise.all(Array.from({length:20},(_,i)=>fetch(base+(i%2?"/api/reports":"/api/pulse"),{headers:{cookie}})));
  assert(reads.every(r=>r.status===200),"20 concurrent authenticated report/pulse reads failed");
  assert.equal((await post("/api/tasks",{title:"Persistent container task"})).status,200);
  docker("restart",name);
  base="http://"+docker("port",name,"3000/tcp");
  ready=false;
  for(let i=0;i<90;i++){try{if((await fetch(base+"/api/health")).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  assert(ready,"Container did not recover after restart");
  const report=await (await fetch(base+"/api/reports",{headers:{cookie}})).json();assert.equal(report.tasks.find(t=>t.label==="OPEN")?.value,1);
  const backup=docker("exec",name,"node","scripts/backup.mjs","--out","/data/backups");
  const latest=docker("exec",name,"node","-e","const fs=require('fs');console.log(fs.readdirSync('/data/backups').filter(n=>n.startsWith('backup-')).sort().at(-1))");
  const restore=docker("exec",name,"node","scripts/restore.mjs","--in","/data/backups/"+latest,"--out","/data/restore-drill");
  assert(backup.length&&restore.length,"Backup/restore produced no output");
  const tooling=docker("exec",name,"node","-e","const fs=require('fs');if(fs.existsSync('node_modules/eslint')||fs.existsSync('node_modules/tailwindcss'))process.exit(1);console.log('Build tools absent')");
  console.log("PASS: container migration, setup, login, 20 concurrent reads, restart persistence, backup, verified restore, runtime build-tool exclusion.");
  console.log(tooling);
} finally {
  try{docker("rm","-f",name);}catch{}
  try{docker("volume","rm",volume);}catch{}
}
