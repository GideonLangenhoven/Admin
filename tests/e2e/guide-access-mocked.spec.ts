import {test,expect,type Page} from "@playwright/test";
const biz="10000000-0000-4000-8000-000000000001",user="10000000-0000-4000-8000-000000000010",slot="10000000-0000-4000-8000-000000000040";
const email="guide+cape-kayak@guides.bookingtours.co.za";
const appOrigin=process.env.GUIDE_PREVIEW_ORIGIN||"http://127.0.0.1:3174";
const operatorOrigin=process.env.GUIDE_OPERATOR_ORIGIN||appOrigin;
const supabaseHost=process.env.GUIDE_SUPABASE_HOST||"guidefixture.supabase.co";
function session(owner=false){const id=owner?"10000000-0000-4000-8000-000000000011":user;const loginEmail=owner?"owner@example.invalid":email;const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const expires=Math.floor(Date.now()/1000)+3600;return {access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,role:'authenticated',aud:'authenticated',exp:expires})}.fixture`,refresh_token:owner?'owner-refresh':'guide-refresh',expires_in:3600,expires_at:expires,token_type:'bearer',user:{id,email:loginEmail,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()}};}
async function fixture(page:Page,signedIn=false,owner=false,shared=false,ownerRole="MAIN_ADMIN",configured=false){
 const auth=session(owner),calls:{path:string;body:any}[]=[];
 const browser=shared?page.context():page;
 let testMode=false;
 const credentials:Record<string,boolean>={wa:configured,yoco:configured,yoco_test:true};
 await browser.routeWebSocket(/realtime/,()=>{});
 await browser.addInitScript(({auth,signedIn,email,biz,storageKey,owner})=>{localStorage.setItem('ck_welcome_done','1');if(signedIn&&!sessionStorage.getItem('guidefixture-seeded')){sessionStorage.setItem('guidefixture-seeded','1');const prefix=owner?'':'guide:';localStorage.setItem(owner?storageKey:storageKey.replace('-auth-token','-guide-auth-token'),JSON.stringify(auth));localStorage.setItem(prefix+'ck_admin_email',auth.user.email);localStorage.setItem(prefix+'ck_admin_time',String(Date.now()));localStorage.setItem(prefix+'ck_admin_business_id',biz);}}, {auth,signedIn,email,biz,owner,storageKey:"sb-"+supabaseHost.split(".")[0]+"-auth-token"});
 await browser.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const token=request.headers().authorization?.split(' ')[1];
  let requestOwner=false;
  try { requestOwner=JSON.parse(Buffer.from(token!.split('.')[1],'base64url').toString()).sub==='10000000-0000-4000-8000-000000000011'; } catch {}
  const requestAuth=session(requestOwner);
  const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
  if(request.method()==='OPTIONS')return json(null,204);
  if(url.pathname==='/api/admin/login'){
   calls.push({path:url.pathname,body:request.postDataJSON()});
   
   return request.headers().authorization?json({auth_ready:true,admin:{id:requestOwner?'owner-a':'guide-a',email:requestAuth.user.email,role:requestOwner?ownerRole:'GUIDE',business_id:biz,name:requestOwner?'Owner':'Guides',read_only:false}}):json({code:'AUTH_REQUIRED'},401);
  }
  if(url.pathname==='/api/guide/access'){
   if(request.method()==='GET') return json({guide:null});
   const body=request.postDataJSON();calls.push({path:url.pathname,body});
   return body.action==='validate'?json({login:'guide@cape-kayak'}):body.action==='complete'?json({ok:true,email,login:'guide@cape-kayak'}):body.action==='issue'&&requestOwner?json({guide:{login_name:'guide@cape-kayak',must_set_password:true,suspended:false},setup_url:'http://127.0.0.1:3174/guide-setup?login=guide%40cape-kayak&token=synthetic'}):json({error:'Synthetic preview refuses management writes'},403);
  }
  if(url.pathname==='/api/guide/check-ins'){const body=request.postDataJSON();calls.push({path:url.pathname,body});return json({ok:true,arrived_count:body.arrived_count});}
  if(url.pathname==='/api/guide/photos'){const trip={id:slot,start_time:'2026-10-15T08:00Z',booked:7,tours:{name:'Morning paddle'}};const photos=[{id:'photo-a',photo_url:'https://drive.google.com/file/d/synthetic/view',gdrive_view_url:'https://drive.google.com/file/d/synthetic/view',uploaded_at:'2026-10-15T08:00Z',slots:trip}];return json(url.searchParams.get('kind')==='slots'?{slots:[trip]}:url.searchParams.get('kind')==='drive'?{connected:true,email:'operator@example.invalid'}:{photos,selected_photos:photos});}
  if(url.pathname==='/api/guide/photo-upload'){calls.push({path:url.pathname,body:request.postData()});return json({ok:true});}
  if(url.pathname.includes('/mfa/')||url.pathname.includes('/factors')){calls.push({path:url.pathname,body:null});return json({error:'MFA is not available in this operator fixture'},403);}
  if(requestOwner&&url.pathname==='/api/credentials'){
   if(request.method()==='GET')return json({...credentials,yoco_test_mode:testMode});
   const body=request.postDataJSON();calls.push({path:url.pathname,body});
   if(body.section==='yoco_test_mode')testMode=body.yoco_test_mode;
   else credentials[body.section]=body.action!=='clear';
   return json({ok:true});
  }
  if(url.pathname.startsWith('/api/'))return json({error:'Synthetic preview refuses other APIs'},403);
  if((url.origin===appOrigin||url.origin===operatorOrigin))return route.continue();
  if(url.hostname!==supabaseHost)return route.abort();
  if(requestOwner&&url.pathname.endsWith('/functions/v1/bank-details')){const body=request.postDataJSON();calls.push({path:url.pathname,body});return json(body.action==='set'?{success:true}:{});}
  if(url.pathname.includes('/auth/v1/user'))return json(requestAuth.user);
  if(url.pathname.includes('/auth/v1/token'))return json(session(request.postDataJSON()?.email==='owner@example.invalid'||request.postDataJSON()?.refresh_token==='owner-refresh'));
  if(url.pathname.includes('/auth/v1/logout')){calls.push({path:url.pathname,body:{scope:url.searchParams.get('scope')}});return json({});}
  if(url.pathname.endsWith('/admin_users'))return json(requestOwner?[{id:'owner-a',user_id:requestAuth.user.id,email:requestAuth.user.email,business_id:biz,role:ownerRole,name:'Owner',suspended:false,read_only:false,created_at:new Date().toISOString()}]:[]);
  if(url.pathname.endsWith('/businesses'))return json([{id:biz,name:'Example Tours',business_name:'Example Tours',timezone:'Africa/Johannesburg',subscription_status:'ACTIVE',subdomain:new URL(operatorOrigin).hostname.split('.')[0]==='aonyx'?'aonyx':'cape-kayak',currency:'ZAR'}]);
  if(url.pathname.endsWith('/guide_accounts'))return json([{id:'guide-a',business_id:biz,login_name:'guide@cape-kayak'}]);
  if(url.pathname.endsWith('/rpc/guide_context'))return json({id:biz,name:'Example Tours',business_name:'Example Tours',timezone:'Africa/Johannesburg',subscription_status:'ACTIVE',subdomain:new URL(operatorOrigin).hostname.split('.')[0]==='aonyx'?'aonyx':'cape-kayak'});
  if(url.pathname.endsWith('/rpc/guide_simple_day'))return json({date:'2026-10-15',currency:'ZAR',unbooked_departures:[],departures:[{id:slot,tour_id:'tour-a',tour_name:'Morning paddle',start_time:'2026-10-15T08:00Z',status:'OPEN',capacity_total:20,available_capacity:null,can_book:false,booked_guests:7,arrived_guests:0,settled_guests:7,bookings:[{id:'10000000-0000-4000-8000-000000000050',slot_id:slot,customer_name:'Alex Guest',phone:'27825550100',email:'alex@example.invalid',qty:7,status:'PAID',waiver_status:'SIGNED',arrived_count:0,checked_in:false,total_amount:700,total_captured:700}]}]});
  if(url.pathname.endsWith('/rpc/guide_day'))return json([{id:slot,tour_name:'Morning paddle',start_time:'2026-10-15T08:00Z',pax_expected:7,booking_count:3,photo_count:1},{id:'10000000-0000-4000-8000-000000000041',tour_name:'Coastal walk',start_time:'2026-10-15T09:00Z',pax_expected:4,booking_count:2,photo_count:0}]);
  if(url.pathname.endsWith('/rpc/guide_photos'))return json({slot:{tour_name:'Morning paddle',start_time:'2026-10-15T08:00Z'},photos:[{id:'photo-a',photo_url:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22%3E%3Crect width=%2232%22 height=%2232%22 fill=%22%23d6e9bc%22/%3E%3C/svg%3E',gdrive_view_url:'https://drive.google.com/file/d/synthetic/view',uploaded_at:'2026-10-15T08:00Z'}]});
  return json([]);
 });
 return calls;
}

test('guide sign-in stays available while an operator is already signed in',async({page})=>{
 await fixture(page,true,true);await page.goto('/simpleguide');
 await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Operator sign in',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Operator sign in',exact:true}).click();
 await expect(page).toHaveURL(appOrigin+'/');
 await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
});

test('a stale guide cookie cannot trap an authenticated admin on the guide page',async({page})=>{
 await fixture(page,true,true);
 await page.context().addCookies([{name:'ck_admin_role',value:'GUIDE',url:appOrigin}]);
 await page.goto('/');
 await expect(page).toHaveURL(appOrigin+'/');
 await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
 expect((await page.context().cookies()).find(cookie=>cookie.name==='ck_admin_role')?.value).toBe('MAIN_ADMIN');
});

async function signIn(page:Page,login:string){
 await page.getByRole('textbox',{name:'Email address or guide login'}).fill(login);
 await page.getByLabel('Password',{exact:true}).fill('chosen-password');
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
}

test('guide and operator tabs keep separate sessions, including refresh, photos and either sign-out',async({page})=>{
 const calls=await fixture(page,false,false,true);await page.goto(operatorOrigin+'/');
 await signIn(page,'owner@example.invalid');
 await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
 const other=await page.context().newPage();await other.goto('/simpleguide');
 await signIn(other,'guide@cape-kayak');
 await expect(other.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
 await page.reload();await other.reload();
 await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
 await expect(other.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 const stored=await page.evaluate(()=>({email:localStorage.getItem('ck_admin_email'),queue:JSON.parse(localStorage.getItem('guide-queue-authority-v2')||'null')}));
 const guideStored=await other.evaluate(()=>({email:localStorage.getItem('guide:ck_admin_email'),queue:JSON.parse(localStorage.getItem('guide:guide-queue-authority-v2')||'null')}));
 expect(stored.email).toBe('owner@example.invalid');expect(guideStored.email).toBe(email);
 expect(stored.queue.userId).not.toBe(guideStored.queue.userId);
 const secondGuide=await page.context().newPage();await secondGuide.goto(appOrigin+'/simpleguide');
 await expect(secondGuide.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 await other.getByRole('link',{name:'Trip photos',exact:true}).click();
 await expect(other.getByRole('heading',{name:'Trip Photos',level:1,exact:true})).toBeVisible({timeout:45000});
 await expect(other.locator('.simple-view')).toBeVisible();
 await other.getByRole('button',{name:'Sign Out',exact:true}).click();
 await expect(other).toHaveURL(appOrigin+'/simpleguide');
 await expect(other.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();
 await expect(secondGuide.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();await secondGuide.close();
 await page.reload();await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
 await signIn(other,'guide@cape-kayak');
 await expect(other.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 await page.getByRole('button',{name:'Sign Out',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();
 await other.reload();await expect(other.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 expect(calls.filter(c=>c.path.includes('/auth/v1/logout')).map(c=>c.body.scope)).toEqual(['local','local']);
});

test('shared guide sign-in opens Simple View, shows pax and blocks office pages',async({page})=>{
 const calls=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/simpleguide');
 await page.getByRole('textbox',{name:'Email address or guide login'}).fill('guide@cape-kayak');
 await page.getByLabel('Password',{exact:true}).fill('chosen-password');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page).toHaveURL(/\/simpleguide$/);await expect(page.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 await expect(page.getByText('Alex Guest',{exact:true})).toBeVisible();
 await expect(page.getByText('27825550100',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Call Alex Guest'})).toHaveAttribute('href','tel:+27825550100');
 await expect(page.getByRole('link',{name:'WhatsApp Alex Guest'})).toHaveAttribute('href','https://wa.me/27825550100');
 await expect(page.getByRole('link',{name:'Full dashboard'})).toHaveCount(0);await expect(page.getByRole('link',{name:'Add walk-in'})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Payment recovery'})).toHaveCount(0);
 expect(calls[0].body.email).toBe(email);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.vercel/guide-access/simple-phone.png',fullPage:true});
 for(const path of ['/simple','/bookings','/settings','/simple/new-booking','/inbox']){await page.goto(path);await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();}
 // A forged advisory cookie cannot turn the verified guide session into an admin.
 await page.context().addCookies([{name:'ck_admin_role',value:'ADMIN',url:appOrigin}]);await page.goto('/settings');await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();
 expect(calls.every(c=>c.path==='/api/admin/login')).toBe(true);
});

test('guide simple view keeps every booked departure and has no payment recovery',async({page},testInfo)=>{
 test.setTimeout(180_000);
 await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
 await fixture(page,true);
 await page.route('**/rest/v1/rpc/guide_simple_day',async route=>{
  const date=route.request().postDataJSON().p_date;
  const departures=['06:00','10:00','14:00'].map((time,index)=>({
   id:`guide-slot-${index}`,tour_id:'tour-a',tour_name:`Guide trip ${index+1}`,start_time:`${date}T${time}:00Z`,status:'OPEN',capacity_total:10,available_capacity:null,can_book:false,booked_guests:1,arrived_guests:0,settled_guests:1,
   bookings:[{id:`guide-guest-${index}`,slot_id:`guide-slot-${index}`,customer_name:`Guest ${index+1}`,phone:null,email:null,qty:1,status:'PAID',waiver_status:'SIGNED',arrived_count:0,checked_in:false,total_amount:100,total_captured:100}],
  }));
  await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({date,currency:'ZAR',unbooked_departures:[],departures})});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/simpleguide',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.sv-departure')).toHaveCount(3);
 await expect(page.getByRole('heading',{name:'Booked sessions',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Departures',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Payment recovery',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Previous day',exact:true}).click();
 await expect(page.getByLabel('Selected date')).toHaveValue('2026-10-14');
 await expect(page.locator('.sv-departure')).toHaveCount(3);
 await page.screenshot({path:testInfo.outputPath('guide-all-departures.png'),fullPage:true});
});

test('guides collapse booked sessions to only their headings',async({page})=>{
 await fixture(page,true);await page.goto('/simpleguide');
 const card=page.locator(`[data-slot-id="${slot}"]`);
 for(const width of [320,390,1024]){
  await page.setViewportSize({width,height:900});
  const header=card.locator('summary.sv-departure-main');
  await expect(card.locator('details')).toHaveAttribute('open');await header.click();
  await expect(card.locator('details')).not.toHaveAttribute('open');
  await expect(card.getByText('Alex Guest',{exact:true})).toBeHidden();
  await expect(card.getByRole('heading',{name:'Morning paddle',exact:true})).toBeVisible();
  await expect(card.locator('time')).toHaveText('10:00');
  await expect(card.getByText('7 booked',{exact:false})).toBeHidden();
  await expect(card.getByRole('link',{name:'Trip photos',exact:true})).toBeHidden();
  await expect(card.getByRole('link',{name:/^Edit arrivals for Alex Guest:/})).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.screenshot({path:`/private/tmp/guide-collapsed-${width}.png`});
  await header.focus();await page.keyboard.press('Enter');
  await expect(card.getByText('Alex Guest',{exact:true})).toBeVisible();
  await expect(card.getByRole('link',{name:'Trip photos',exact:true})).toBeVisible();
  await expect(card.getByRole('link',{name:/^Edit arrivals for Alex Guest:/})).toBeVisible();
  const editUrl=new URL((await card.getByRole('link',{name:/^Edit arrivals for Alex Guest:/}).getAttribute('href'))!,page.url());
  expect(editUrl.pathname).toBe('/simpleguide/check-ins');expect(editUrl.searchParams.get('slot')).toBe(slot);
 }
});

test('guide gets the same Photos tools with the trip preselected and can return to roll call',async({page})=>{
 await fixture(page,true);await page.setViewportSize({width:390,height:844});await page.goto('/simpleguide');
 await page.getByRole('link',{name:'Trip photos',exact:true}).click();
 await expect(page).toHaveURL(new RegExp('/simpleguide/photos/'+slot));
 await expect(page.getByRole('heading',{name:'Trip Photos',level:1,exact:true})).toBeVisible();
 await expect(page.locator('.simple-view')).toBeVisible();
 await expect(page.getByText('Field Console',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send photos',exact:true})).toBeEnabled();
 await expect(page.locator('input[type=file]')).toHaveAttribute('accept','image/*,video/*');
 await expect(page.getByRole('heading',{name:'Recent Photo Links',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.vercel/guide-access/photos-phone.png',fullPage:true});
 await page.getByRole('link',{name:'Roll call',exact:true}).click();await expect(page.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
});

test('one-time password setup signs the guide straight into Simple View',async({page})=>{
 const calls=await fixture(page);await page.goto('/guide-setup?login=guide%40cape-kayak&token='+ 'a'.repeat(48));
 await page.getByLabel('Password',{exact:true}).fill('chosen-password');await page.getByLabel('Confirm password',{exact:true}).fill('chosen-password');
 await page.getByRole('button',{name:'Set password',exact:true}).click();
 await expect(page).toHaveURL(/\/simpleguide$/);await expect(page.getByRole('heading',{name:'Roll call',exact:true,level:1})).toBeVisible();
 expect(calls.filter(c=>c.body?.action==='complete')).toHaveLength(1);
});

 test('operator creates one shared guide login and shares a private password link',async({page})=>{
 const calls=await fixture(page,true,true);await page.goto('/settings');
 await page.getByRole('button',{name:'Admin Users',exact:true}).click();
 const panel=page.getByRole('region',{name:'Guide login',exact:true});
 await panel.getByRole('button',{name:'Create guide login',exact:true}).click();
 await expect(panel.getByText('guide@cape-kayak',{exact:true})).toBeVisible();
 await expect(panel.getByLabel('Private password setup link')).toHaveValue(/guide-setup\?login=guide%40cape-kayak/);
 await expect(panel.locator('input[type=password]')).toHaveCount(0);
 expect(calls.filter(c=>c.body?.action==='issue')).toHaveLength(1);
 });

for(const accountRole of ['MAIN_ADMIN','SUPER_ADMIN']) {
test(accountRole+' saves banking and all integration settings without MFA prompts or requests',async({page})=>{
 const calls=await fixture(page,true,true,false,accountRole);await page.goto('/settings');
 await page.locator('#invoice > button').click();
 await page.getByLabel('Account owner',{exact:true}).fill('Example Owner');
 await page.getByLabel('Account number',{exact:true}).fill('123456789');
 await page.getByRole('button',{name:'Save invoice details',exact:true}).click();
 await expect(page.getByText('Invoice and banking details saved.',{exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path.endsWith('/bank-details')&&c.body.action==='set')).toHaveLength(1);
 await page.locator('#credentials > button').click();
 for(const [section,values,button,message] of [
  ['whatsapp',['synthetic-token','123456'],'Save WhatsApp Credentials','WhatsApp credentials saved and encrypted successfully.'],
  ['yoco',['sk_live_synthetic','whsec_synthetic'],'Save Yoco Credentials','Yoco credentials saved and encrypted successfully.'],
  ['yoco-test',['sk_test_synthetic','whsec_test_synthetic'],'Save test credentials','Yoco test credentials saved and encrypted successfully.'],
 ] as const){
  const form=page.locator(`form[data-demo-submit="credentials.${section}"]`);
  await form.locator('input').nth(0).fill(values[0]);await form.locator('input').nth(1).fill(values[1]);
  await form.getByRole('button',{name:button,exact:true}).click();
  await expect(page.getByText(message,{exact:false})).toBeVisible();
 }
 await page.getByRole('button',{name:'Enable Test Mode',exact:true}).click();
 await expect(page.getByRole('button',{name:'Disable Test Mode',exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path==='/api/credentials').map(c=>c.body.section)).toEqual(['wa','yoco','yoco_test','yoco_test_mode']);
 await expect(page.getByText(/authenticator|MFA:/i)).toHaveCount(0);
 expect(calls.filter(c=>c.path.includes('/mfa/')||c.path.includes('/factors'))).toHaveLength(0);
});
}

for(const accountRole of ['MAIN_ADMIN','SUPER_ADMIN']) {
test(accountRole+' cancels removal, retries a failure and reconfigures integrations',async({page})=>{
 const calls=await fixture(page,true,true,false,accountRole,true);await page.goto('/settings');
 await page.locator('#credentials > button').click();
 const whatsapp=page.getByRole('button',{name:'Remove WhatsApp configuration',exact:true});
 await whatsapp.click();
 await expect(page.getByText('Remove WhatsApp configuration?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(calls.filter(c=>c.body?.action==='clear')).toHaveLength(0);
 await expect(whatsapp).toBeEnabled();
 let fail=true;
 await page.route('**/api/credentials',async route=>{
  if(fail&&route.request().method()==='POST'&&route.request().postDataJSON()?.action==='clear'){
   fail=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Temporary removal failure. Try again.'})});
  }
  return route.fallback();
 });
 await whatsapp.click();await page.getByRole('button',{name:'Remove configuration',exact:true}).click();
 await expect(page.getByText('Temporary removal failure. Try again.',{exact:true})).toBeVisible();
 await expect(whatsapp).toBeEnabled();
 await page.getByRole('button',{name:'Enable Test Mode',exact:true}).click();
 for(const [section,name,values,saveButton] of [
  ['whatsapp','WhatsApp',['replacement-token','654321'],'Save WhatsApp Credentials'],
  ['yoco','Yoco live',['sk_live_replacement','whsec_replacement'],'Save Yoco Credentials'],
  ['yoco-test','Yoco test',['sk_test_replacement','whsec_test_replacement'],'Save test credentials'],
 ] as const){
  const form=page.locator(`form[data-demo-submit="credentials.${section}"]`);
  await form.getByRole('button',{name:`Remove ${name} configuration`,exact:true}).click();
  await expect(page.getByText(`Remove ${name} configuration?`,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove configuration',exact:true}).click();
  await expect(form.getByText(/^(?:⚠ )?Not set$/)).toBeVisible();
  await expect(form.getByRole('button',{name:`Remove ${name} configuration`,exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Disable Test Mode',exact:true})).toBeVisible();
  if(section==='yoco-test'){
   await page.setViewportSize({width:390,height:844});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await form.locator('input').nth(0).fill(values[0]);await form.locator('input').nth(1).fill(values[1]);
  await form.getByRole('button',{name:saveButton,exact:true}).click();
  await expect(form.getByText(/^(?:✓ )?Configured$/)).toBeVisible();
  if(section==='yoco-test'){
   const dismissButtons=page.locator('.pointer-events-none.fixed.right-4 button');
   while(await dismissButtons.count())await dismissButtons.first().click();
   await form.screenshot({path:'/private/tmp/integration-settings-'+accountRole+'-phone.png'});
  }
 }
 expect(calls.filter(c=>c.body?.action==='clear').map(c=>c.body.section)).toEqual(['wa','yoco','yoco_test']);
 await page.setViewportSize({width:1440,height:1100});
 await page.locator('form[data-demo-submit="credentials.whatsapp"]').screenshot({path:'/private/tmp/integration-settings-'+accountRole+'-desktop.png'});
 await page.reload();await page.locator('#credentials > button').click();
 for(const section of ['whatsapp','yoco','yoco-test'])await expect(page.locator(`form[data-demo-submit="credentials.${section}"]`).getByText(/^(?:✓ )?Configured$/)).toBeVisible();
});
}

test('Super Admin removes credentials from the explicitly selected operator in support',async({page})=>{
 const calls=await fixture(page,true,true,false,'SUPER_ADMIN',true);await page.goto('/super-admin/sensitive-actions');
 await page.getByLabel('Operator business').selectOption(biz);
 for(const name of ['WhatsApp','Yoco live','Yoco test']){
  await page.getByRole('button',{name:`Remove ${name} configuration`,exact:true}).click();
  await expect(page.getByLabel('Operator business')).toBeDisabled();
  await page.getByRole('button',{name:'Remove configuration',exact:true}).click();
  await expect(page.getByRole('button',{name:`Remove ${name} configuration`,exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Operator business')).toBeEnabled();
 }
 expect(calls.filter(c=>c.body?.action==='clear').map(c=>[c.body.business_id,c.body.section])).toEqual([[biz,'wa'],[biz,'yoco'],[biz,'yoco_test']]);
});

 test('guides share roll-call and partial-arrival controls without desk payments',async({page})=>{
 const calls=await fixture(page,true);await page.goto('/simpleguide');
 await page.getByRole('checkbox',{name:"Mark all of Alex Guest's group as present"}).click();
 await expect.poll(()=>calls.filter(c=>c.path==='/api/guide/check-ins').length).toBe(1);
 expect(calls.find(c=>c.path==='/api/guide/check-ins')?.body.arrived_count).toBe(7);
 await page.getByRole('article').getByRole('link',{name:'Check-ins',exact:true}).click();
 await expect(page).toHaveURL(/\/simpleguide\/check-ins/);
 await page.getByRole('button',{name:'Increase arrived guests'}).click();
 await page.getByRole('button',{name:'Save arrivals',exact:true}).click();
 await expect.poll(()=>calls.filter(c=>c.path==='/api/guide/check-ins').length).toBe(2);
 expect(calls.filter(c=>c.path==='/api/guide/check-ins')[1].body.arrived_count).toBe(1);
 await expect(page.getByRole('button',{name:/Confirm .* received/})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Add walk-in'})).toHaveCount(0);
 });
