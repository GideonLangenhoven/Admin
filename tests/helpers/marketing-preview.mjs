import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

// Isolated Next runtime: no .env files, auth tokens or production hosts are copied.
const root=resolve('.'), preview=mkdtempSync('/private/tmp/bookingtours-marketing-preview-');
const previewPort=Number(process.env.MARKETING_PREVIEW_PORT||3156), fixturePort=Number(process.env.MARKETING_FIXTURE_PORT||3157);
for(const file of ['app/marketing','app/vouchers','components/DatePicker.tsx','app/lib','app/globals.css','components/marketing','components/BusinessContext.tsx','components/SectionTabs.tsx','supabase/functions/_shared','tailwind.config.js','postcss.config.js','tsconfig.json','package.json']){
 const target=join(preview,file);mkdirSync(resolve(target,'..'),{recursive:true});cpSync(join(root,file),target,{recursive:true});
}
symlinkSync(join(root,'node_modules'),join(preview,'node_modules'),'dir');
writeFileSync(join(preview,'next.config.ts'),'export default { devIndicators: false, webpack(config) { config.cache = false; return config; } };');
writeFileSync(join(preview,'app/layout.tsx'),`import './globals.css';import { BusinessProvider } from '../components/BusinessContext';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body style={{fontFamily:"system-ui,sans-serif"}}><BusinessProvider value={{businessId:'10000000-0000-4000-8000-000000000001',businessName:'Example Tours (synthetic)',role:'MAIN_ADMIN',logoUrl:'',timezone:'Africa/Johannesburg',readOnly:false}}><main className="p-4 sm:p-8 mx-auto max-w-7xl">{children}</main></BusinessProvider></body></html>}`);
const state={mutations:[],providerCalls:0,rpcCalls:[],audienceError:false};
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,OPTIONS');res.setHeader('Content-Type','application/json');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const url=new URL(req.url,'http://127.0.0.1:'+fixturePort);
 if(url.pathname==='/__fixture/reset'&&req.method==='POST'){state.audienceError=false;state.mutations=[];state.rpcCalls=[];res.end('{}');return;}
 if(url.pathname==='/__fixture/state'){res.end(JSON.stringify(state));return;}
 if(url.pathname==='/__fixture/audience-error'&&req.method==='POST'){state.audienceError=true;res.end('{}');return;}
 if(url.pathname==='/rest/v1/rpc/marketing_goal_audiences'){
  state.rpcCalls.push('marketing_goal_audiences');
  if(state.audienceError){res.writeHead(503);res.end('{"message":"Synthetic audience unavailable"}');return;}
  res.end(JSON.stringify({reviews:{included:0,excluded:4},welcome:{included:0,excluded:4},winback:{included:0,excluded:4},vouchers:{included:null,excluded:null}}));return;
 }
 if(url.pathname==='/rest/v1/rpc/marketing_audience_summary'){
  state.rpcCalls.push('marketing_audience_summary');
  if(state.audienceError){res.writeHead(503);res.end('{"message":"Synthetic audience unavailable"}');return;}
  res.end('{"permission_unknown":4}');return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){
  let raw='';for await(const part of req)raw+=part;state.mutations.push({path:url.pathname,body:JSON.parse(raw||'{}')});
  res.writeHead(403);res.end('{"message":"Synthetic fixture refuses writes and providers"}');return;
 }
 const table=url.pathname.split('/').pop();
 let rows=table==='businesses'?[{marketing_email_usage:0,marketing_included_emails:500,marketing_overage_rate_zar:0.15}]:[];
 if(req.headers.prefer?.includes('count=exact'))res.setHeader('Content-Range',`0-${Math.max(0,rows.length-1)}/${rows.length}`);
 res.end(JSON.stringify(req.headers.accept?.includes('vnd.pgrst.object')?rows[0]||null:rows));
});
server.listen(fixturePort,'127.0.0.1');
const env=Object.fromEntries(['PATH','USER','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:'+fixturePort,NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-only',NEXT_TELEMETRY_DISABLED:'1'});
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','-H','127.0.0.1','-p',String(previewPort)],{cwd:preview,env,stdio:'inherit'});
writeFileSync('/private/tmp/bookingtours-marketing-preview-path',preview);
console.log(`Synthetic marketing UI: http://127.0.0.1:${previewPort}/marketing; fixture: http://127.0.0.1:${fixturePort}; source copy:`,preview);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);server.close();});
child.on('exit',code=>{server.close();process.exit(code||0);});
