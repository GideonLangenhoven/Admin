// Build the actual app in an isolated copy with fake local-only credentials.
// Existing Google fonts may be fetched by next/font; no deployment or provider integration runs.
import {cpSync,existsSync,mkdirSync,mkdtempSync,symlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
const root=resolve('.'),directory=mkdtempSync('/private/tmp/bookingtours-operator-build-');
for(const name of ['app','components','supabase/functions/_shared','public','tests','scripts','next.config.ts','next-env.d.ts','tsconfig.json','postcss.config.js','tailwind.config.js','package.json','instrumentation.ts','instrumentation-client.ts','sentry.server.config.ts','sentry.edge.config.ts','proxy.ts']){
 if(!existsSync(join(root,name)))continue;
 mkdirSync(dirname(join(directory,name)),{recursive:true});cpSync(join(root,name),join(directory,name),{recursive:true,filter:source=>!['node_modules','.next'].includes(source.split('/').pop())&&!source.split('/').pop().startsWith('.env')});
}
symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),'dir');
const env=Object.fromEntries(['PATH','USER','TMPDIR','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3161',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-only',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',NEXT_TELEMETRY_DISABLED:'1'});
console.log('Isolated production build:',directory,'; fake credentials only');
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:directory,env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code||0;});child.on('error',error=>{console.error(error.message);process.exitCode=1;});
