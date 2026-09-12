// Live API verification. Fixtures are five paused businesses with fictional
// contacts, no provider credentials and random passwords. No email is sent.
// Only IDs created by this process may be removed during cleanup.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(url && anon && service, 'Load the configured project environment');
const db = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const mode = process.argv[2] || 'inventory';
const result = async request => {
  const response = await request;
  if(response.error) throw new Error(response.error.message);
  return response.data;
};
if(mode==='inventory') {
  const businesses = await result(db.from('businesses').select('id,business_name,subdomain,subscription_status').order('created_at'));
  const routes = new Map();
  for(const b of businesses) {
    const raw = await result(db.rpc('get_business_credentials',{p_business_id:b.id,p_key:process.env.SETTINGS_ENCRYPTION_KEY}));
    const c = Array.isArray(raw)?raw[0]:raw;
    const phone = c?.wa_phone_id || '';
    if(phone) { const group=routes.get(phone)||[];group.push(b.subdomain);routes.set(phone,group); }
    console.log(JSON.stringify({...b,testMode:c?.yoco_test_mode===true,hasTestKey:!!c?.yoco_test_secret_key,hasTestWebhook:!!c?.yoco_test_webhook_secret,hasLiveKey:!!c?.yoco_secret_key,hasLiveWebhook:!!c?.yoco_webhook_secret,hasWhatsapp:!!(phone&&c?.wa_token)}));
  }
  console.log(JSON.stringify({duplicateWhatsappRouting:[...routes.values()].filter(group=>group.length>1)}));
  process.exit(0);
}
if(mode==='captures') {
  const discrepancies = await result(db.rpc('r13_capture_report'));
  for(const row of discrepancies) {
    const b = await result(db.from('bookings').select('id,payment_method,yoco_checkout_id,payment_status,is_combo').eq('id',row.booking_id).single());
    console.log(JSON.stringify({...row,...b}));
  }
  process.exit(0);
}
assert(mode==='isolation','Use inventory, captures or isolation');
const fixtures=[];const failures=[];let checks=0;
const run=randomBytes(5).toString('hex');
const check=(name,ok)=>{checks++;console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failures.push(name);};
const headers=(token,extra={})=>({apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json',...extra});
async function request(path,token,method='GET',body,extra={}) {
  const response=await fetch(url+path,{method,headers:headers(token,extra),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  return {status:response.status,body:await response.json().catch(()=>null)};
}
try {
  for(let n=0;n<5;n++) {
    const f={business:randomUUID(),tour:randomUUID(),slot:randomUUID(),customer:randomUUID(),booking:randomUUID(),voucher:randomUUID(),waiver:randomUUID(),email:`release-${run}-${n}@example.invalid`,password:randomBytes(24).toString('base64url')};
    fixtures.push(f);
    await result(db.from('businesses').insert({id:f.business,name:`Release isolation ${run} ${n}`,business_name:`Release isolation ${run} ${n}`,subdomain:`release-${run}-${n}`,operator_email:f.email,subscription_status:'PAUSED'}));
    const created=await db.auth.admin.createUser({email:f.email,password:f.password,email_confirm:true});
    if(created.error)throw created.error;f.user=created.data.user.id;
    await result(db.from('admin_users').insert({business_id:f.business,user_id:f.user,email:f.email,name:'Release fixture',role:'MAIN_ADMIN',password_hash:createHash('sha256').update(f.password).digest('hex'),must_set_password:false}));
    await result(db.from('tours').insert({id:f.tour,business_id:f.business,name:'Hidden release fixture',active:false,hidden:true,base_price_per_person:100,default_capacity:10}));
    await result(db.from('slots').insert({id:f.slot,business_id:f.business,tour_id:f.tour,start_time:new Date(Date.now()+10*86400000).toISOString(),capacity_total:10,status:'OPEN'}));
    await result(db.from('customers').insert({id:f.customer,business_id:f.business,email:f.email,name:'Release fixture'}));
    await result(db.from('bookings').insert({id:f.booking,business_id:f.business,tour_id:f.tour,slot_id:f.slot,customer_id:f.customer,customer_name:'Release fixture',email:f.email,phone:'',qty:1,unit_price:100,total_amount:100,status:'PENDING',source:'WEB',waiver_token:f.waiver,marketing_opt_in:false}));
    await result(db.from('vouchers').insert({id:f.voucher,business_id:f.business,code:randomBytes(4).toString('hex').toUpperCase(),value:100,current_balance:100,type:'CREDIT',status:'ACTIVE'}));
    const login=await fetch((process.env.ADMIN_URL||'https://admin.bookingtours.co.za')+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password}),signal:AbortSignal.timeout(30000)});
    const auth=await login.json();assert(login.ok&&auth.session?.access_token,'Real administrator login failed: '+login.status);f.token=auth.session.access_token;
    check(`client ${n+1} signs in through the administrator app`,auth.admin?.business_id===f.business);
  }
  for(const [i,a] of fixtures.entries()) {
    for(const [table,pk] of [['businesses','business'],['bookings','booking'],['customers','customer'],['vouchers','voucher']]) {
      const own=await request(`/rest/v1/${table}?id=eq.${a[pk]}&select=id`,a.token);
      check(`client ${i+1} reads its own ${table}`,own.status===200&&own.body?.length===1);
    }
    for(const [j,b] of fixtures.entries()) {
      if(i===j)continue;
      const spoof={'x-tenant-business-id':b.business,'x-booking-success-token':b.booking};
      const credentials=await fetch((process.env.ADMIN_URL||'https://admin.bookingtours.co.za')+'/api/credentials?business_id='+b.business,{headers:{Authorization:'Bearer '+a.token},signal:AbortSignal.timeout(20000)});
      check(`client ${i+1} cannot read client ${j+1} integration credentials`,credentials.status===403);
      for(const [table,pk] of [['businesses','business'],['bookings','booking'],['customers','customer'],['vouchers','voucher']]) {
        const read=await request(`/rest/v1/${table}?id=eq.${b[pk]}&select=id`,a.token,'GET',undefined,spoof);
        check(`client ${i+1} cannot read client ${j+1} ${table}`,read.status===200&&Array.isArray(read.body)&&read.body.length===0);
      }
      const patch=await request(`/rest/v1/bookings?id=eq.${b.booking}&select=id`,a.token,'PATCH',{customer_name:'Forbidden fixture change'},{...spoof,Prefer:'return=representation'});
      check(`client ${i+1} cannot update client ${j+1} booking`,[401,403].includes(patch.status)||(patch.status===200&&patch.body?.length===0));
      for(const [rpc,args] of [['deduct_voucher_balance',{p_voucher_id:b.voucher,p_amount:1}],['calculate_booking_refund',{p_booking_id:b.booking}],['create_hold_with_capacity_check',{p_booking_id:b.booking,p_slot_id:b.slot,p_qty:1,p_expires_at:new Date(Date.now()+900000).toISOString()}]]) {
        const denied=await request('/rest/v1/rpc/'+rpc,a.token,'POST',args,spoof);
        check(`client ${i+1} cannot invoke ${rpc} on client ${j+1}`,denied.status===403&&denied.body?.code==='42501');
      }
      for(const [column,id] of [['tour_id',b.tour],['slot_id',b.slot],['customer_id',b.customer]]) {
        const denied=await request(`/rest/v1/bookings?id=eq.${a.booking}`,a.token,'PATCH',{[column]:id});
        check(`client ${i+1} cannot attach client ${j+1} ${column}`,denied.status===409&&denied.body?.code==='23503');
      }
      for(const fn of ['cancel-booking','process-refund','manual-mark-paid','confirm-booking']) {
        const denied=await request('/functions/v1/'+fn,a.token,'POST',{booking_id:b.booking,action:'mark_paid'});
        check(`client ${i+1} cannot use ${fn} for client ${j+1}`,denied.status===403);
      }
    }
    const untrusted=await request(`/rest/v1/bookings?id=eq.${a.booking}&select=id`,anon,'GET',undefined,{'x-tenant-business-id':a.business,'x-booking-success-token':a.booking});
    check(`anonymous reference cannot read client ${i+1} booking`,untrusted.status===200&&untrusted.body?.length===0);
    const proof=await request(`/rest/v1/bookings?id=eq.${a.booking}&select=id`,anon,'GET',undefined,{'x-tenant-business-id':a.business,'x-booking-id':a.booking,'x-booking-waiver-token':a.waiver});
    check(`customer proof still reads its client ${i+1} booking`,proof.status===200&&proof.body?.length===1);
    await result(db.from('admin_users').update({suspended:true}).eq('user_id',a.user));
    const suspended=await request(`/rest/v1/bookings?id=eq.${a.booking}&select=id`,a.token);
    check(`suspending client ${i+1} blocks its existing session`,suspended.status===200&&suspended.body?.length===0);
  }
  if(process.env.RELEASE_CAPACITY_RACE==='1') {
    const f=fixtures[0], bookingIds=[f.booking], proofs=[f.waiver];
    await result(db.from('slots').update({capacity_total:2}).eq('id',f.slot));
    for(let i=0;i<4;i++) {
      const id=randomUUID(),proof=randomUUID(); bookingIds.push(id);proofs.push(proof);
      await result(db.from('bookings').insert({id,business_id:f.business,tour_id:f.tour,slot_id:f.slot,customer_name:'Release race fixture',email:f.email,phone:'',qty:1,unit_price:100,total_amount:100,status:'PENDING',source:'WEB',waiver_token:proof,marketing_opt_in:false}));
    }
    const output=execFileSync('k6',['run','tests/stress/double-spend.k6.js'],{encoding:'utf8',timeout:60000,env:{...process.env,URL:url,KEY:anon,SLOT:f.slot,BUSINESS:f.business,BOOKINGS:bookingIds.join(','),TOKENS:proofs.join(','),FREE_SEATS:'2'}});
    console.log(output);
    check('five live concurrent booking proofs reserve exactly the two available seats',true);
    const slot=await result(db.from('slots').select('held,booked,capacity_total').eq('id',f.slot).single());
    check('live race leaves held plus booked within capacity',slot.held+slot.booked===2&&slot.capacity_total===2);
  }
} finally {
  // Exact generated IDs only. Keep unrelated businesses and auth users intact.
  for(const f of fixtures) {
    for(const [table,column,id] of [['vouchers','business_id',f.business],['bookings','business_id',f.business],['slots','business_id',f.business],['tours','business_id',f.business],['customers','business_id',f.business],['admin_users','business_id',f.business],['businesses','id',f.business]]) {
      await result(db.from(table).delete().eq(column,id));
    }
    if(f.user){const removed=await db.auth.admin.deleteUser(f.user);if(removed.error)throw removed.error;}
  }
  console.log(`Removed ${fixtures.length} disposable release businesses and their test accounts.`);
}
console.log(`${checks-failures.length}/${checks} live isolation checks passed`);
assert.equal(failures.length,0,failures.join('\n'));
