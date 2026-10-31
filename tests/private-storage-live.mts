import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {persistPrivateFile,ensurePrivateFile} from '../src/lib/private-storage';
const root=path.resolve(process.env.UPLOAD_ROOT!),file=path.join(root,'storage-probe-'+randomUUID()+'.bin'),bytes=Buffer.from('Synthetic private-storage integrity probe.');
await fs.mkdir(root,{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});await persistPrivateFile(file);assert.equal(path.dirname(path.resolve(file)),root);await fs.unlink(file);await ensurePrivateFile(file);assert.deepEqual(await fs.readFile(file),bytes);console.log('Private cloud storage verified after local cache removal.');
