// Render real pages with synthetic data, isolated from all external services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),{build}=require('esbuild'),postcss=require('postcss'),tailwind=require('tailwindcss'),{chromium}=require('playwright'),ts=require('typescript');
const out=path.join(root,'.impeccable/review/gift-voucher');fs.mkdirSync(out,{recursive:true});
const photo=fs.readFileSync(path.join(root,'public/demo/claires-hiking/assets/kayak-sunset.webp'));
const theme={id:'10000000-0000-4000-8000-000000000001',business_name:'Cape Kayak',email_img_gift:'http://gift.test/default.webp',color_main:'#1b3b36',color_cta:'#b55d38',logo_url:null};
const tour={id:'10000000-0000-4000-8000-000000000002',business_id:theme.id,name:'Sunset paddle',description:'Explore the coast at sunset.',active:true,hidden:false,image_url:'http://gift.test/tour.webp',voucher_image_url:'http://gift.test/photo.webp',base_price_per_person:750,duration_minutes:90,sort_order:0,default_capacity:10};
const voucher={code:'GIFT2345',value:750,type:'MONETARY',recipient_name:'Alex',buyer_name:'Sam',buyer_email:'sam@example.invalid',gift_message:'Happy birthday!\nHere’s to another adventure together.',gift_tour_name:tour.name,gift_image_url:tour.voucher_image_url,expires_at:'2029-10-18'};
const fixture=`const theme=${JSON.stringify(theme)},tour=${JSON.stringify(tour)},voucher=${JSON.stringify(voucher)};window.fixture={theme,tour,voucher,mutations:[],uploads:[],failDesigns:location.search.includes("failDesigns")};if(location.search.includes("noImage"))voucher.gift_image_url=null;
export const supabase={from(table){let single=false,payload,verb='select';const chain=new Proxy(()=>chain,{get(_,key){if(key==='then')return(resolve,reject)=>Promise.resolve().then(()=>{if(verb!=='select'){window.fixture.mutations.push({table,verb,payload});if(table==='tours')Object.assign(tour,payload);return {data:single?{id:tour.id}:[],error:null};}if(table==='tours'&&window.fixture.failDesigns)return {data:null,error:{message:'Offline'}};const data=table==='tours'?[tour]:table==='businesses'?[{...theme,name:theme.business_name}]:table==='admin_users'?[{settings_permissions:{tours:true,site:true}}]:table==='vouchers'?(location.pathname.includes('confirmed')?[voucher]:[]):[];return {data:single?data[0]||null:data,error:null,count:data.length};}).then(resolve,reject);return(...args)=>{if(key==='single'||key==='maybeSingle')single=true;if(['insert','update'].includes(key)){verb=key;payload=args[0];}return chain;}}});return chain;},rpc:async()=>({data:[],error:null}),functions:{invoke:async()=>({data:{redirectUrl:'https://checkout.example.invalid'},error:null})},auth:{getSession:async()=>({data:{session:null}})},storage:{from(bucket){return {upload:async(key,file)=>{window.fixture.uploads.push({bucket,key,size:file.size});if(window.fixture.failUpload)return {error:{message:'Synthetic upload failure'}};return {error:null}},getPublicUrl:key=>({data:{publicUrl:'http://gift.test/upload.webp'}})}}}};export const createTenantSupabase=()=>supabase,createVoucherSupabase=()=>supabase;`;
async function bundle(admin){
 const dir=admin?root:root+'/booking';
 const content=admin?`import React from 'react';import {createRoot} from 'react-dom/client';import Settings from '${root}/app/settings/page';import Vouchers from '${root}/app/vouchers/page';const Page=location.pathname==='/settings'?Settings:Vouchers;createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'0 auto',padding:20}}><Page/></main>);`:`import React from 'react';import {createRoot} from 'react-dom/client';import Voucher from '${root}/booking/app/voucher/page';import Confirmed from '${root}/booking/app/voucher-confirmed/page';const Page=location.pathname==='/confirmed'?Confirmed:Voucher;createRoot(document.getElementById('root')).render(<Page/>);`;
 const plugin={name:'synthetic-services',setup(b){
  const modules={
   supabase:fixture,
   theme:`export const useTheme=()=>(${JSON.stringify(theme)});`,
   context:`export const useBusinessContext=()=>({businessId:'${theme.id}',businessName:'Cape Kayak',role:'ADMIN'});`,
   notify:`export const notify=(value)=>{window.lastNotice=value};export const confirmAction=async()=>true;`,
   link:`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
   image:`import React from 'react';export default function Image(props){return <img {...props}/>}`,
   navigation:`export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useRouter=()=>({push:()=>{},replace:()=>{}});`,
   dynamic:`export default function dynamic(){return ()=>null}`,
   sentry:`export const setTag=()=>{};export const captureException=()=>{};`,
   empty:`export default function Empty(){return null}`,
  };
  b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'supabase',namespace:'mock'}));
  b.onResolve({filter:/ThemeProvider$/},()=>({path:'theme',namespace:'mock'}));
  b.onResolve({filter:/BusinessContext$/},()=>({path:'context',namespace:'mock'}));
  b.onResolve({filter:/app-notify$/},()=>({path:'notify',namespace:'mock'}));
  b.onResolve({filter:/^next\/(link|image|navigation|dynamic)$/},a=>({path:a.path.split('/')[1],namespace:'mock'}));
  b.onResolve({filter:/^@sentry\/nextjs$/},()=>({path:'sentry',namespace:'mock'}));
  b.onResolve({filter:/(GuideAccessSettings|WhatsAppBotSection|ExternalBookingSettings|RichTextEditor|InlineSlotManager|BookingSitePreview|RemoveIntegrationButton|DataRequestBadge)$/},()=>({path:'empty',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:modules[a.path],loader:'jsx',resolveDir:root}));
 }};
 const js=await build({stdin:{contents:content,loader:'tsx',resolveDir:root},bundle:true,write:false,outfile:'/private/tmp/gift-voucher-bundle.js',format:'iife',platform:'browser',jsx:'automatic',plugins:[plugin],alias:{react:root+'/node_modules/react','react-dom':root+'/node_modules/react-dom'},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},tsconfig:dir+'/tsconfig.json'});
 const config=require(dir+'/tailwind.config.js');config.content=[dir+'/app/**/*.{ts,tsx}',root+'/components/**/*.{ts,tsx}',{raw:content,extension:'tsx'}];
 const css=await postcss([tailwind(config)]).process(fs.readFileSync(dir+'/app/globals.css','utf8'),{from:dir+'/app/globals.css'});
 return {js:js.outputFiles.find(file=>file.path.endsWith('.js')).text,css:(js.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'')+css.css+'\n:root{--font-sans:Arial,sans-serif;--font-display:Arial,sans-serif}*{animation:none!important;transition:none!important}'};
}
function email(mode="recipient"){
 const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+'/supabase/functions/_shared/gift-voucher-face.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,URL});
 const source=fs.readFileSync(root+'/supabase/functions/send-email/index.ts','utf8');const fn=source.slice(source.indexOf('function giftVoucherHtml('),source.indexOf('\nfunction cancellationHtml('));
 const render=vm.runInNewContext(ts.transpileModule(fn+'\ngiftVoucherHtml;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
 const face=mod.exports.renderGiftVoucherFace({imageUrl:voucher.gift_image_url,businessName:'Cape Kayak',experienceName:tour.name,recipientName:'Alex',buyerName:'Sam',message:voucher.gift_message,value:750,code:voucher.code,expiresLabel:'Valid until 18 October 2029',monetary:true});
 return render({...voucher,gift_recipient_mode:mode},face).replaceAll('{{BOOKING_URL}}','https://kayak.example.invalid');
}
(async()=>{
 const [admin,guest]=await Promise.all([bundle(true),bundle(false)]);
 if(process.argv.includes('--bundle-only')){console.log('PASS page bundles');return;}
 const browser=await chromium.launch({channel:'chrome'});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR',error.message)});
 await page.route('**/*',route=>{const url=route.request().url();return route.fulfill(url.endsWith('.webp')?{contentType:'image/webp',body:photo}:{contentType:'text/html',body:'<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});});
 async function mount(url,bundle){await page.goto('http://gift.test'+url);await page.evaluate(()=>{localStorage.setItem('ck_admin_role','ADMIN');localStorage.setItem('ck_admin_email','admin@example.invalid')});await page.addStyleTag({content:bundle.css});await page.addScriptTag({content:bundle.js});}
 async function capture(name){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/'+name+'.png',fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' horizontal overflow');}
 try{
 for(const width of [320,1440]){
  await page.setViewportSize({width,height:900});await mount('/voucher',guest);await page.getByRole('button',{name:'R750',exact:true}).click();await page.getByRole('button',{name:'Continue: R750'}).click();await page.getByLabel('Choose your gift’s photo').selectOption(tour.id);await page.getByLabel('Recipient Name *',{exact:true}).fill('Alex');await page.getByLabel('Your Name *',{exact:true}).fill('Sam');await page.getByLabel('Your Email *',{exact:true}).fill('sam@example.invalid');await page.getByLabel('Personal Message (optional)').fill(voucher.gift_message);await capture(width===320?'mobile':'desktop');
  assert((await page.locator('[data-gift-voucher-face]').innerText()).includes(voucher.gift_message));
  await page.getByLabel('Personal Message (optional)').fill(('Happy birthday! <script>alert(1)</script>\n'+ 'a'.repeat(100)+'\n').repeat(5));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'long message overflow');assert.equal(await page.locator('[data-gift-voucher-face] script').count(),0);await page.getByLabel('Personal Message (optional)').fill(voucher.gift_message);
  await page.getByRole('button',{name:'Purchase Voucher: R750'}).click();await page.getByText('Complete Secure Payment').waitFor();const sent=await page.evaluate(()=>window.fixture.mutations.find(item=>item.table==='vouchers').payload);assert.equal(sent.gift_tour_id,tour.id);assert.equal(sent.gift_message,voucher.gift_message);assert.equal(sent.type,'MONETARY');assert(!('gift_image_url' in sent));
  await mount('/confirmed?code=GIFT2345',guest);await page.getByText('GIFT2345',{exact:true}).waitFor();await capture('confirmed-'+width);
  await page.goto('http://gift.test/email');await page.setContent(email());await capture('email-'+width);
  await mount('/settings#tours',admin);await page.getByText('Sunset paddle',{exact:true}).first().click();await page.getByText('Gift voucher photo',{exact:true}).waitFor();await page.getByLabel('Upload gift voucher photo').setInputFiles({name:'experience.webp',mimeType:'image/webp',buffer:photo});await page.getByText('Preview gift voucher',{exact:true}).click();await page.locator('[data-gift-voucher-face]').waitFor();await capture('settings-'+width);await page.getByRole('button',{name:'Update Tour',exact:true}).click();const saved=await page.evaluate(()=>window.fixture.mutations.find(item=>item.table==='tours'&&item.verb==='update'));assert.equal(saved.payload.voucher_image_url,'http://gift.test/upload.webp');const upload=await page.evaluate(()=>window.fixture.uploads[0]);assert.equal(upload.bucket,'email-images');assert(upload.key.startsWith(theme.id+'/voucher-photos/'));
  await mount('/vouchers',admin);await page.getByLabel('Gift voucher photo',{exact:true}).selectOption(tour.id);await page.locator('textarea[name="gift_message"]').fill(voucher.gift_message);await page.getByLabel('Recipient',{exact:true}).fill('Alex');await page.getByLabel('Buyer name',{exact:true}).fill('Sam');await page.getByLabel('Buyer email',{exact:true}).fill('sam@example.invalid');await page.getByLabel('Value (ZAR)',{exact:true}).fill('750');await page.getByText('Preview gift voucher',{exact:true}).click();await capture('operator-'+width);await page.getByRole('button',{name:'Send payment link',exact:true}).click();await page.getByText(/Payment link sent to/).waitFor();const operatorPayload=await page.evaluate(()=>window.fixture.mutations.find(item=>item.table==='vouchers').payload);assert.equal(operatorPayload.gift_tour_id,tour.id);assert.equal(operatorPayload.gift_message,voucher.gift_message);
  console.log('PASS purchase selection/payload, long/injected messages, saved confirmation, full gift email, actual settings upload/save and operator design at '+width);
 }
 await page.setViewportSize({width:320,height:900});
 await mount('/settings#tours',admin);await page.getByText('Sunset paddle',{exact:true}).first().click();
 const uploadField=page.getByLabel('Upload gift voucher photo');
 await uploadField.setInputFiles({name:'not-a-photo.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
 assert.equal((await page.evaluate(()=>window.fixture.uploads)).length,0);
 assert((await page.evaluate(()=>window.lastNotice.message)).includes('Choose a JPG'));
 await uploadField.setInputFiles({name:'oversized.webp',mimeType:'image/webp',buffer:Buffer.alloc(5*1024*1024+1)});
 assert.equal((await page.evaluate(()=>window.fixture.uploads)).length,0);
 assert((await page.evaluate(()=>window.lastNotice.message)).includes('under 5 MB'));
 await page.evaluate(()=>window.fixture.failUpload=true);await uploadField.setInputFiles({name:'photo.webp',mimeType:'image/webp',buffer:photo});
 await page.waitForFunction(()=>window.lastNotice?.title==='Upload failed');await page.getByText('Preview gift voucher',{exact:true}).click();
 assert((await page.locator('[data-gift-voucher-face] td[background]').first().getAttribute('background')).endsWith('/photo.webp'));
 await page.getByRole('button',{name:'Use tour image',exact:true}).click();assert((await page.locator('[data-gift-voucher-face] td[background]').first().getAttribute('background')).endsWith('/tour.webp'));
 await page.getByRole('button',{name:'Update Tour',exact:true}).click();assert.equal((await page.evaluate(()=>window.fixture.mutations.find(item=>item.table==='tours'))).payload.voucher_image_url,null);
 await mount('/voucher?failDesigns=1',guest);await page.getByRole('button',{name:'R750',exact:true}).click();await page.getByRole('button',{name:'Continue: R750'}).click();await page.getByText('Experience photos couldn’t load.',{exact:false}).waitFor();await page.evaluate(()=>window.fixture.failDesigns=false);await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByLabel('Choose your gift’s photo').selectOption(tour.id);
 await mount('/confirmed?code=GIFT2345&noImage=1',guest);await page.getByText('GIFT2345',{exact:true}).waitFor();assert.equal(await page.locator('[data-gift-voucher-face] td[background]').count(),0);assert((await page.locator('[data-gift-voucher-face]').innerText()).includes(voucher.gift_message));
 for(const mode of ['buyer_receipt','buyer_forward']){await page.goto('http://gift.test/email');await page.setContent(email(mode));assert.equal(await page.locator('[data-gift-voucher-face]').count(),1);assert((await page.locator('[data-gift-voucher-face]').innerText()).includes(voucher.gift_message));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 console.log('PASS invalid/oversized uploads, failed upload preserves photo, reset/save tour image, design-load retry, no-photo confirmation and both buyer email modes.');
 assert.deepEqual(errors,[]);console.log('PASS no runtime errors; screenshots '+out);
 }catch(error){console.error((await page.locator('body').innerText()).slice(0,3500));throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
