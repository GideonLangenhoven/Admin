import { cpSync, mkdtempSync, symlinkSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const reused=process.env.KAYAK_DEMO_PREBUILT;
if(reused && (!/^\/private\/tmp\/capekayak-kayak-preview-[A-Za-z0-9]+\/booking$/.test(reused) || !existsSync(join(reused,'.next/BUILD_ID')))) throw new Error('Only a completed, disposable Kayak preview can be reused');
const preview=reused||join(mkdtempSync('/private/tmp/capekayak-kayak-preview-'),'booking');
if(!reused) {
mkdirSync(preview);
// Start from committed storefront code and add only the cookie accessibility fix.
// Other active chat-widget changes cannot slip into the preview or deployment.
const archive=execFileSync('git',['archive','--format=tar','HEAD'],{cwd:resolve('booking'),maxBuffer:100*1024*1024});
execFileSync('tar',['-xf','-','-C',preview],{input:archive});
cpSync(resolve('booking/app/components/CookieBanner.tsx'),join(preview,'app/components/CookieBanner.tsx'));
// Permit the isolated fixture origin only in this disposable build. Production
// keeps its original CSP and talks to the permitted Supabase HTTPS origin.
const config=join(preview,'next.config.ts');
writeFileSync(config,readFileSync(config,'utf8').replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3107"));
symlinkSync(resolve('booking/node_modules'),join(preview,'node_modules'),'dir');
cpSync('/private/tmp/capekayak-kayak-demo-photos',join(preview,'public/__kayak-demo'),{recursive:true});
}
writeFileSync('/private/tmp/capekayak-kayak-demo-preview-path',preview);
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3107',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-fixture-anon-key',NEXT_PUBLIC_BUSINESS_ID:'44ff11ab-c697-47de-9227-0ffa51db127c',NEXT_TELEMETRY_DISABLED:'1'};
// Do not inherit monitoring credentials into the isolated test build.
for(const key of Object.keys(env)) if(/SENTRY|SUPABASE_SERVICE|SUPABASE_ACCESS|YOCO|RESEND/.test(key)) delete env[key];
const options={cwd:preview,stdio:'inherit',env};
const cli=resolve('booking/node_modules/next/dist/bin/next');
let child=spawn(process.execPath,[cli,...(reused?['start','-H','127.0.0.1','-p','3106']:['build','--webpack'])],options);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{
  if(reused) {process.exit(code||0);return;}
  if(code!==0) {process.exit(code||1);return;}
  // This build-only cache is unnecessary for next start and can exceed 500 MB.
  rmSync(join(preview,'.next/cache'),{recursive:true,force:true});
  child=spawn(process.execPath,[cli,'start','-H','127.0.0.1','-p','3106'],options);
  child.on('exit',code=>process.exit(code||0));
});
