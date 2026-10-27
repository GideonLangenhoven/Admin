// Real Settings/Super Admin pages with synthetic services; no live network.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { build } = require('esbuild'), postcss = require('postcss'), tailwind = require('tailwindcss'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..'), out = fs.mkdtempSync('/private/tmp/bookingtours-admin-contact-ui-');
const business = { id: '10000000-0000-4000-8000-000000000003', name: 'Example Tours', business_name: 'Example Tours', subdomain: 'example', max_admin_seats: 10, subscription_status: 'ACTIVE', timezone: 'Africa/Johannesburg' };
const owner = { id: '10000000-0000-4000-8000-000000000001', user_id: '10000000-0000-4000-8000-000000000002', business_id: business.id, name: 'Example Owner', email: 'owner@example.invalid', phone: '+27 82 555 0100', role: 'MAIN_ADMIN', suspended: false, must_set_password: false, password_set_at: '2026-10-01', created_at: '2026-10-01', settings_permissions: {} };
const fixture = `const business=${JSON.stringify(business)}, owner=${JSON.stringify(owner)};
export const supabase={from(table){let single=false;const q=new Proxy(()=>q,{get(_,key){if(key==='then')return(resolve,reject)=>Promise.resolve({data:single?(table==='businesses'?business:table==='admin_users'?owner:null):(table==='businesses'?[business]:table==='admin_users'?[owner]:[]),error:null,count:table==='admin_users'?1:0}).then(resolve,reject);return(...args)=>{if(key==='single'||key==='maybeSingle')single=true;return q;}}});return q;},rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:{access_token:'fixture-token',user:{id:owner.user_id,email:owner.email}}}})},functions:{invoke:async()=>({data:{},error:null})},storage:{from(){return {getPublicUrl:()=>({data:{publicUrl:''}})}}}};export const createTenantSupabase=()=>supabase;`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Settings from '${root}/app/settings/page';import SuperAdmin from '${root}/app/super-admin/page';const Page=location.pathname==='/settings'?Settings:SuperAdmin;createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'0 auto',padding:16}}><Page/></main>);`;
async function main() {
  const modules = {
    supabase: fixture,
    context: `export const useBusinessContext=()=>({businessId:'${business.id}',businessName:'Example Tours',role:location.pathname==='/settings'?'MAIN_ADMIN':'SUPER_ADMIN',readOnly:location.search.includes('readonly'),refreshBusiness:async()=>{}});`,
    notify: `export const notify=value=>{window.lastNotice=value};export const confirmAction=async()=>true;`,
    link: `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
    navigation: `export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useRouter=()=>({push:()=>{},replace:()=>{}});`,
    dynamic: `export default function dynamic(){return ()=>null}`,
    empty: `export default function Empty(){return null}`,
    sentry: `export const setTag=()=>{};export const captureException=()=>{};`,
  };
  const plugin = {name:'synthetic-services',setup(b){
    b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'supabase',namespace:'mock'}));
    b.onResolve({filter:/BusinessContext$/},()=>({path:'context',namespace:'mock'}));
    b.onResolve({filter:/app-notify$/},()=>({path:'notify',namespace:'mock'}));
    b.onResolve({filter:/^next\/(link|navigation|dynamic)$/},a=>({path:a.path.split('/')[1],namespace:'mock'}));
    b.onResolve({filter:/^@sentry\/nextjs$/},()=>({path:'sentry',namespace:'mock'}));
    b.onResolve({filter:/(GuideAccessSettings|WhatsAppBotSection|ExternalBookingSettings|RichTextEditor|InlineSlotManager|BookingSitePreview|RemoveIntegrationButton|DataRequestBadge|PlatformOperations)$/},()=>({path:'empty',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:modules[a.path],loader:'jsx',resolveDir:root}));
  }};
  const bundled = await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,outfile:path.join(out,'bundle.js'),format:'iife',platform:'browser',jsx:'automatic',plugins:[plugin],define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
  const config=require(root+'/tailwind.config.js');config.content=[root+'/app/**/*.{ts,tsx}',root+'/components/**/*.{ts,tsx}'];
  const css=(await postcss([tailwind(config)]).process(fs.readFileSync(root+'/app/globals.css','utf8'),{from:root+'/app/globals.css'})).css;
  const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n:root{--font-sans:Arial,sans-serif;--font-display:Arial,sans-serif}*{animation:none!important;transition:none!important}</style></head><body><div id="root"></div><script>${bundled.outputFiles[0].text}</script></body></html>`;
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    for(const routeName of ['settings','super-admin']) for(const width of [390,1280]) {
      const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({role,email,businessId})=>{localStorage.setItem('ck_admin_role',role);localStorage.setItem('ck_admin_email',email);localStorage.setItem('ck_admin_name','Example Owner');localStorage.setItem('ck_admin_business_id',businessId);},{role:routeName==='settings'?'MAIN_ADMIN':'SUPER_ADMIN',email:routeName==='settings'?owner.email:'platform@example.invalid',businessId:business.id});
      let failure=false,requests=[];
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.hostname==='contact.test'&&req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
        if(url.pathname==='/api/admin/contact') {
          const data=req.postDataJSON();requests.push(data);
          assert.equal(req.headers()['x-admin-business-id'],business.id);assert.equal(req.headers().authorization,'Bearer fixture-token');
          return route.fulfill({status:failure?409:200,contentType:'application/json',body:JSON.stringify(failure?{error:'This email is already used by another administrator'}:{ok:true,self:routeName==='settings',admin:{...owner,name:data.name.trim(),email:data.email.trim().toLowerCase(),phone:data.phone.trim()||null}})});
        }
        if(url.pathname.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:'{}'});
        return route.abort();
      });
      await page.goto('http://contact.test/'+routeName+(routeName==='settings'?'#admins':''));
      if(routeName==='super-admin')await page.getByRole('button',{name:'View / Edit Details'}).click();
      const edit=page.getByRole('button',{name:'Edit contact details',exact:true});await edit.click();
      const form=page.locator('form').filter({has:page.getByRole('button',{name:'Save contact details',exact:true})});
      assert.equal(await form.getByLabel('Name',{exact:true}).inputValue(),owner.name);
      assert.equal(await form.getByLabel('Email address',{exact:true}).inputValue(),owner.email);
      await form.getByLabel('Name',{exact:true}).fill('Changed Owner');
      await form.getByLabel('Email address',{exact:true}).fill('new@example.invalid');
      await form.getByLabel('Phone number (optional)').fill('+27 82 555 0200');
      await form.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,`${routeName}-${width}.png`)});
      assert(await form.evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'Editor fits viewport');
      failure=true;await form.getByRole('button',{name:'Save contact details',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'already used'}).waitFor();assert.equal(await form.getByLabel('Name',{exact:true}).inputValue(),'Changed Owner');
      failure=false;await form.getByRole('button',{name:'Save contact details',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Contact details saved.'}).waitFor();
      assert.equal(requests.length,2);assert.equal(requests[1].expected_email,owner.email);
      assert.equal(await page.evaluate(()=>localStorage.getItem('ck_admin_email')),routeName==='settings'?'new@example.invalid':'platform@example.invalid');
      await edit.click();assert.equal(await form.getByLabel('Email address',{exact:true}).inputValue(),'new@example.invalid');
      await form.getByLabel('Phone number (optional)').fill('');await form.getByRole('button',{name:'Save contact details',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Contact details saved.'}).waitFor();
      await edit.click();assert.equal(await form.getByLabel('Phone number (optional)').inputValue(),'');
      await form.getByLabel('Name',{exact:true}).fill('Unsaved name');await form.getByRole('button',{name:'Cancel',exact:true}).click();
      await edit.click();assert.equal(await form.getByLabel('Name',{exact:true}).inputValue(),'Changed Owner');
      assert.deepEqual(errors,[]);await context.close();
      console.log(`PASS ${routeName} at ${width}px: prefill, error retention, save, self-session sync, phone clearing and cancel`);
    }
    const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('ck_admin_role','MAIN_ADMIN'));
    await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({contentType:'application/json',body:'{}'}));
    await page.goto('http://contact.test/settings?readonly#admins');assert.equal(await page.getByRole('button',{name:'Edit contact details',exact:true}).isDisabled(),true);
    console.log('PASS read-only account cannot open the editor');console.log('Screenshots:',out);
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
