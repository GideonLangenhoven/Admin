// Disposable PostgreSQL 17 only; no project environment or hosted connection is read.
import {mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const directory=mkdtempSync('/private/tmp/capekayak-db-test-'),port='55437';
const bin='/opt/homebrew/opt/postgresql@17/bin';
const env=Object.fromEntries(['PATH','USER','LANG','TMPDIR'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const run=(file,args,stdio='inherit')=>{const r=spawnSync(file,args,{env,stdio});if(r.error)throw r.error;if(r.status!==0)throw new Error(file+' failed with '+r.status);};
let started=false;
try{
 run(join(bin,'initdb'),['-D',join(directory,'data'),'-A','trust','--no-locale','-E','UTF8'],'ignore');
 run(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-o',`-h '' -k ${directory} -p ${port}`,'-w','start']);started=true;
 run(process.execPath,['tests/guide-access-local.mjs',directory,port]);
}finally{if(started)run(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-m','fast','-w','stop']);}
