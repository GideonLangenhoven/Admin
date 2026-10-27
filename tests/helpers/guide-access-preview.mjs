import {cpSync,mkdirSync,mkdtempSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
// Synthetic configuration only. No production env, keys or provider access.
const root=resolve('.'),preview=mkdtempSync('/private/tmp/bookingtours-guide-access-');
const port=process.env.GUIDE_PREVIEW_PORT||'3174';
mkdirSync(join(root,'.vercel/guide-access'),{recursive:true});
for(const name of ['app','components','supabase/functions/_shared','public','package.json','tsconfig.json','tailwind.config.js','postcss.config.js','proxy.ts']){
 const target=join(preview,name);mkdirSync(resolve(target,'..'),{recursive:true});cpSync(join(root,name),target,{recursive:true});
}
symlinkSync(join(root,'node_modules'),join(preview,'node_modules'),'dir');
writeFileSync(join(preview,'next.config.ts'),'export default {devIndicators:false,webpack(config){config.cache=false;return config;}};');
writeFileSync(join(preview,'app/layout.tsx'),`import './globals.css';import AuthGate from '../components/AuthGate';import AppShell from '../components/AppShell';import AppNotifications from '../components/AppNotifications';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body style={{fontFamily:'system-ui,sans-serif'}}><AppNotifications/><AuthGate><AppShell nav={[{href:'/',label:'Dashboard',icon:'LayoutDashboard'},{href:'/simple',label:'Simple view',icon:'ListChecks'},{href:'/settings',label:'Settings',icon:'Gear'}]}>{children}</AppShell></AuthGate></body></html>}`);
const env=Object.fromEntries(['PATH','USER','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:'https://guidefixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-only',NEXT_TELEMETRY_DISABLED:'1',E2E_BYPASS_RATE_LIMIT:'1'});
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','-H','127.0.0.1','-p',port],{cwd:preview,env,stdio:'inherit'});
writeFileSync(join(root,'.vercel/guide-access/preview-path.txt'),preview);
console.log('Guide preview with synthetic configuration: http://127.0.0.1:'+port);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));
