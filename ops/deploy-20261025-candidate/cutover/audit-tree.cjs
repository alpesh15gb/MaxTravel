// Canonical content inventory; reject symlinks/special files, stream file hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function inventory(root) {
 const out=[];let top;
 try {top=fs.lstatSync(root);}catch(e){if(e.code==='ENOENT')return {present:false,files:[]};throw e;}
 if(!top.isDirectory()||top.isSymbolicLink())throw Error('not a real directory');
 async function walk(dir,prefix='') {
  for(const name of fs.readdirSync(dir).sort()) {
   const file=path.join(dir,name),rel=prefix+name,st=fs.lstatSync(file);
   if(st.isSymbolicLink())throw Error('symlink');
   if(st.isDirectory()){out.push([rel+'/', 'directory']);await walk(file,rel+'/');}
   else if(st.isFile()) {
    const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);
    out.push([rel,st.size,h.digest('hex')]);
   } else throw Error('special file');
  }
 }
 await walk(root);return {present:true,files:out};
}
(async()=>{const root=process.argv[2]||'/audit-data';console.log(JSON.stringify({uploads:await inventory(path.join(root,'uploads')),packageMedia:await inventory(path.join(root,'package-media'))}));})()
.catch(()=>{console.error('Tree audit failed: unreadable/symlink/special file; no contents printed.');process.exitCode=1;});
