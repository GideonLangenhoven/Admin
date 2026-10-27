import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import ts from 'typescript';
import vm from 'node:vm';
const questionModule={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync('supabase/functions/_shared/booking-custom-fields.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:questionModule.exports,Date,Set,Number,Object,Array,JSON});
const {applicableBookingQuestions,captureQuestionFields}=questionModule.exports;
const fields=(raw,answers,tour=id(3))=>captureQuestionFields(applicableBookingQuestions(raw,tour,id(1)),answers,id(1),tour);
const simpleQuestions=[{key:'safety',label:'Safety information',required:true}];
const host=process.argv[2],port=Number(process.argv[3]);
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host||''),'Disposable local socket required');
assert(Number.isInteger(port)&&port>1024&&port<65536);
const config={host,port,user:process.env.USER},database='operator_fixture_'+randomBytes(6).toString('hex');
const admin=new pg.Client({...config,database:'postgres'}),db=new pg.Client({...config,database});
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let created=false,passed=0;
const migration=async name=>db.query(readFileSync('supabase/migrations/'+name,'utf8'));
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function as(client,role,user,fn){await client.query('begin');try{await client.query('set local role '+role);await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub:id(user)})]);const result=await fn();await client.query('commit');return result;}catch(e){await client.query('rollback');throw e;}}
const rpc=(name,params,client=db)=>client.query(`select ${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) result`,params).then(r=>r.rows[0].result);
const payload=(overrides={})=>({tour_id:id(3),slot_id:id(4),customer_name:'Synthetic Guest',email:'synthetic@example.invalid',phone:'27825550100',adults:2,children:1,status:'CONFIRMED',hold_hours:24,discount_type:'none',custom_fields:fields(simpleQuestions,{safety:'Synthetic safety answer'},overrides.tour_id||id(3)),add_ons:{},expected_total:300,...overrides});
try{
 await admin.connect();await admin.query('create database '+database);created=true;await db.connect();
 await db.query(readFileSync('tests/fixtures/rollout-schema.sql','utf8'));
 await db.query(readFileSync('tests/fixtures/rollout-policies.sql','utf8'));
 await db.query("alter table admin_users add column read_only boolean not null default false; alter table conversations add column current_intent text; create table if not exists trip_photos(id uuid,business_id uuid,slot_id uuid,uploaded_at timestamptz); create function settle_voucher_reservations(uuid) returns jsonb language sql as $$select '{\"success\":true}'::jsonb$$;");
 await db.query(`create table invoices (
 id uuid primary key default gen_random_uuid(),business_id uuid references businesses(id),booking_id uuid references bookings(id),invoice_number text not null,
 customer_name text,customer_email text,customer_phone text,tour_name text,tour_date timestamptz,qty integer,unit_price numeric,subtotal numeric,total_amount numeric,
 payment_method text,payment_reference text,status text,created_at timestamptz default now(),discount_type text,discount_percent numeric,discount_amount numeric,discount_notes text,unique(business_id,invoice_number));`);
 await migration('20260920100000_partial_booking_arrivals.sql');
 await migration('20260922110000_operator_dashboard_snapshot.sql');
 await migration('20260922123000_operator_hot_path_admission.sql');
 const pricing=readFileSync('supabase/migrations/20260911130000_checkout_pricing.sql','utf8');
 await db.query('alter table bookings add column checkout_priced_at timestamptz,add column checkout_request jsonb,add column expected_amount_cents integer');
 await db.query(pricing.slice(pricing.indexOf('CREATE OR REPLACE FUNCTION public.create_hold_with_capacity_check'),pricing.indexOf('CREATE OR REPLACE FUNCTION public.prepare_booking_checkout')));
 await migration('20260911170000_manual_booking_capacity.sql');
 await migration('20260319130400_invoice_sequence.sql');
 await migration('20260929100000_invoice_numbers_per_business.sql');
 await migration('20260425120000_promo_atomic_enforcement.sql');
 await migration('20261015170000_operator_daily_consistency.sql');
 await migration('20261020160000_simple_paid_arrivals.sql');
 await migration('20261015171000_operator_booking_transaction.sql');
 await migration('20261015172000_operator_cancellation_money.sql');
 await migration('20261020170000_cancellation_notification_only.sql');
 await db.query('create table logs(id uuid default gen_random_uuid(),business_id uuid,booking_id uuid,event text,payload jsonb,created_at timestamptz default now())');
 await migration('20261015120000_payment_recovery.sql');
 await migration('20261016110000_unpaid_booking_recovery.sql');
 await migration('20261016123000_payment_recovery_departures.sql');
 await db.query("alter table bookings add column if not exists expected_currency text default 'ZAR'");
 await migration('20261016140000_admin_extra_pax.sql');
 await migration('20260921140000_durable_notification_jobs.sql');
 await migration('20261018120000_manual_booking_deadlines.sql');
 for(const [table,columns] of Object.entries(JSON.parse(readFileSync('tests/fixtures/operator-columns.local.json','utf8')))){
  const actual=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table])).rows.map(row=>row.column_name);
  for(const column of columns)assert(actual.includes(column),table+'.'+column+' exists in applied candidate schema');
 }
 await db.query("insert into businesses(id,name,operator_email,timezone,subscription_status,booking_custom_fields) values($1,'Synthetic A','owner-a@example.invalid','Africa/Johannesburg','ACTIVE','[{\"key\":\"safety\",\"label\":\"Safety information\",\"required\":true}]'),($2,'Synthetic B','owner-b@example.invalid','Africa/Johannesburg','ACTIVE','[]')",[id(1),id(2)]);
 for(const [n,role,biz,readonly] of [[10,'ADMIN',1,false],[11,'OPERATOR',1,false],[12,'ADMIN',2,false],[13,'ADMIN',1,true]])await db.query("insert into admin_users(id,user_id,email,password_hash,role,business_id,read_only) values($1,$2,$3,'synthetic',$4,$5,$6)",[id(n),id(n+100),'admin'+n+'@example.invalid',role,id(biz),readonly]);
 await db.query("insert into tours(id,business_id,name,active,base_price_per_person,default_capacity) values($1,$2,'Synthetic paddle',true,100,20)",[id(3),id(1)]);
 await db.query("insert into tours(id,business_id,name,active,base_price_per_person,default_capacity) values($1,$2,'Other activity',true,100,8)",[id(8),id(1)]);
 await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,status,booked,held) values($1,$2,$3,'2099-10-15T08:00Z',20,'OPEN',0,0),($4,$2,$3,'2099-10-16T08:00Z',20,'OPEN',0,0),($5,$2,$6,'2099-10-15T08:00Z',8,'OPEN',0,0)",[id(4),id(1),id(3),id(5),id(6),id(8)]);
 await check('atomic create preserves child composition, safety answers, confirmed due and invoice',async()=>{
  const r=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(20),payload()]));assert.equal(r.ok,true);assert.equal(r.total_captured,0);assert.equal(r.qty,3);
  const b=(await db.query('select party_composition,custom_fields,invoice_id from bookings where id=$1',[id(20)])).rows[0];assert.deepEqual(b.party_composition,{adults:2,children:1});assert(b.invoice_id);assert.equal(b.custom_fields.safety,'Synthetic safety answer');
 });
 await check('unknown price cannot become a free booking; an explicit zero price remains valid',async()=>{
  await assert.rejects(db.query('update tours set base_price_per_person=null where id=$1',[id(3)]),/not-null constraint/);
  await db.query('update tours set base_price_per_person=-1 where id=$1',[id(3)]);
  await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(52),payload({expected_total:0})])),/price is unavailable/);
  assert.equal((await db.query('select count(*)::int n from bookings where id=$1',[id(52)])).rows[0].n,0);
  await db.query('update tours set base_price_per_person=0 where id=$1',[id(3)]);
  const free=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(52),payload({slot_id:id(5),expected_total:0})]));assert.equal(free.total_amount,0);
  // Remove this extra fixture from later day-manifest assertions.
  await db.query("update bookings set status='CANCELLED' where id=$1",[id(52)]);
  await db.query('update slots set booked=greatest(0,booked-3) where id=$1',[id(5)]);
  await db.query('update tours set base_price_per_person=100 where id=$1',[id(3)]);
 });
 await check('duplicate request creates exactly one booking, capacity claim and invoice',async()=>{
  const r=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(20),payload()]));assert.equal(r.replay,true);
  assert.equal((await db.query('select count(*)::int n from invoices where booking_id=$1',[id(20)])).rows[0].n,1);assert.equal((await db.query('select booked from slots where id=$1',[id(4)])).rows[0].booked,3);
  await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(20),payload({adults:3})])),/already saved different/);
 });
 await check('required safety, quantity, price and tenant validation fail without partial writes',async()=>{
  for(const change of [{custom_fields:{}},{adults:-1},{adults:2.5},{expected_total:1},{slot_id:id(5),tour_id:id(8)}])await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(21),payload(change)])));
  await assert.rejects(as(db,'authenticated',112,()=>rpc('create_operator_booking',[id(1),id(21),payload()])),/Unauthorized/);
  await assert.rejects(as(db,'authenticated',113,()=>rpc('create_operator_booking',[id(1),id(21),payload()])),/Unauthorized/);
  assert.equal((await db.query('select count(*)::int n from bookings where id=$1',[id(21)])).rows[0].n,0);
 });
 await check('manual bookings require email; optional phone stays validated and recovery follows the balance',async()=>{
  try {
   for(const [n,status,contacts] of [[60,'PENDING',{email:'required@example.invalid',phone:null}],[61,'HELD',{email:'required@example.invalid',phone:''}],[62,'CONFIRMED',{email:'required@example.invalid',phone:null}],[63,'PAID',{email:'required@example.invalid',phone:null}]]){
    const result=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(n),payload({...contacts,status,slot_id:id(5)})]));
    assert.equal(result.ok,true);
    const row=(await db.query('select * from payment_recovery_bookings where id=$1',[id(n)])).rows[0];
    assert.equal(row.departure_at.toISOString(),'2099-10-16T08:00:00.000Z');assert.equal(row.slot_id,id(5));assert.equal(row.tour_name,'Synthetic paddle');assert.equal(row.departure_passed,false);
    assert.equal(row.email,'required@example.invalid');assert.equal(row.phone,null);assert.equal(Number(row.amount_due),status==='PAID'?0:300);assert.equal(row.payment_failed_at,null);
   }
   for(const change of [{customer_name:''},{email:'invalid'},{email:null},{email:''},{phone:'abc'},{phone:'123'}])await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(64),payload(change)])));
   await db.query('update bookings set total_captured=100 where id=$1',[id(62)]);
   assert.equal(Number((await db.query('select amount_due from payment_recovery_bookings where id=$1',[id(62)])).rows[0].amount_due),200);
   await as(db,'authenticated',110,async()=>{
    const own=(await db.query('select departure_at,tour_name from payment_recovery_bookings where id=$1',[id(60)])).rows[0];
    assert.equal(own.departure_at.toISOString(),'2099-10-16T08:00:00.000Z');assert.equal(own.tour_name,'Synthetic paddle');
   });
   await db.query('update bookings set slot_id=$1 where id=$2',[id(4),id(60)]);
   assert.equal((await db.query('select id from payment_recovery_bookings where id=any($1::uuid[]) order by departure_passed asc nulls last,departure_at asc nulls last,slot_id,id',[[60,61,62].map(id)])).rows[0].id,id(60));
   await db.query("update slots set start_time='2020-10-16T08:00Z' where id=$1",[id(5)]);
   assert.equal((await db.query('select departure_passed from payment_recovery_bookings where id=$1',[id(61)])).rows[0].departure_passed,true);
   assert.equal((await db.query('select id from payment_recovery_bookings where id=any($1::uuid[]) order by departure_passed asc nulls last,departure_at asc nulls last,slot_id,id',[[60,61].map(id)])).rows[0].id,id(60),'upcoming departures precede past trips');
   await as(db,'authenticated',112,async()=>assert.equal((await db.query('select * from payment_recovery_bookings where business_id=$1',[id(1)])).rows.length,0));
   await assert.rejects(as(db,'anon',110,()=>db.query('select * from payment_recovery_bookings')),/permission denied/);
   assert.equal((await db.query("select has_table_privilege('authenticated','payment_recovery_bookings','INSERT,UPDATE,DELETE') writes")).rows[0].writes,false);
   await assert.rejects(as(db,'authenticated',110,()=>db.query('update payment_recovery_bookings set customer_name=$1 where id=$2',['Changed',id(60)])),/permission denied|cannot update view/);
  } finally {
   // These fixture bookings must not affect the existing capacity/manifest assertions.
   await db.query('delete from operator_booking_requests where id=any($1::uuid[])',[[60,61,62,63].map(id)]);
   await db.query('delete from invoices where booking_id=any($1::uuid[])',[[60,61,62,63].map(id)]);
   await db.query('delete from holds where booking_id=any($1::uuid[])',[[60,61,62,63].map(id)]);
   await db.query('delete from bookings where id=any($1::uuid[])',[[60,61,62,63].map(id)]);
   await db.query("update slots set booked=0,held=0,start_time='2099-10-16T08:00Z' where id=$1",[id(5)]);
  }
 });
 const arrival=(count,event='fixture-arrival',booking=20,user=110,source='simple-view')=>as(db,'authenticated',user,()=>rpc('record_authenticated_booking_arrival',[id(booking),id(1),count,0,event,source,null,null]));
 await check('confirmed unpaid and partially paid arrivals fail through server policy and legacy direct write',async()=>{
  assert.equal((await arrival(3)).code,'PAYMENT_REQUIRED');await db.query("update bookings set total_captured=100,waiver_status='SIGNED' where id=$1",[id(20)]);assert.equal((await arrival(3)).code,'PAYMENT_REQUIRED');
  await assert.rejects(as(db,'authenticated',110,()=>db.query('update bookings set checked_in=true where id=$1',[id(20)])),/Record payment/);
 });
 await check('only admins can approve account/reseller arrival; reference/reason required; waiver remains mandatory',async()=>{
  const args=[id(1),id(20),'approve','SYNTHETIC-ACCOUNT','Verified synthetic reseller account'];
  await assert.rejects(as(db,'authenticated',111,()=>rpc('approve_account_arrival',args)),/Admin approval/);
  await assert.rejects(as(db,'authenticated',112,()=>rpc('approve_account_arrival',args)),/Admin approval/);
  await assert.rejects(as(db,'authenticated',110,()=>rpc('approve_account_arrival',[id(1),id(20),'approve','',''])),/Reference/);
  await as(db,'authenticated',110,()=>rpc('approve_account_arrival',args));
  await db.query("update bookings set waiver_status='PENDING' where id=$1",[id(20)]);assert.equal((await arrival(3,'approved-waiver',20,110,'dashboard')).code,'WAIVER_REQUIRED');
  await db.query("update bookings set waiver_status='SIGNED' where id=$1",[id(20)]);
  for(const source of ['simple-view','simple-guide'])assert.equal((await arrival(3,'unpaid-'+source,20,110,source)).code,'PAYMENT_REQUIRED');
  assert.equal((await db.query('select arrived_count from bookings where id=$1',[id(20)])).rows[0].arrived_count,0);
  await db.query('update bookings set total_captured=total_amount where id=$1',[id(20)]);
  assert.equal((await arrival(1,'paid-simple')).ok,true);
  const correction=await as(db,'authenticated',110,()=>rpc('record_authenticated_booking_arrival',[id(20),id(1),0,1,'paid-correction','simple-view',null,null]));
  assert.equal(correction.ok,true);
  assert.equal((await arrival(1,'paid-guide',20,110,'simple-guide')).ok,true);
  await as(db,'authenticated',110,()=>rpc('record_authenticated_booking_arrival',[id(20),id(1),0,1,'guide-correction','simple-guide',null,null]));
  await db.query('update bookings set total_captured=100 where id=$1',[id(20)]);
  assert.equal((await arrival(3,'approved-arrival',20,111,'dashboard')).ok,true);
 });
 await check('arrival retry is idempotent, stale corrections fail, moving away and back invalidates approval',async()=>{
  assert.equal((await arrival(3,'approved-arrival',20,111)).replay,true);
  assert.equal((await arrival(2,'stale')).code,'STALE');
  await db.query('update bookings set slot_id=$1 where id=$2',[id(5),id(20)]);await db.query('update bookings set slot_id=$1 where id=$2',[id(4),id(20)]);
  assert.equal((await arrival(3,'after-move')).code,'PAYMENT_REQUIRED');
  await assert.rejects(as(db,'authenticated',110,()=>db.query('delete from booking_arrival_approvals')),/permission denied/);
 });
 await check('manifest uses exact slot identity and operator dates including unpaid holds; cancelled/expired excluded',async()=>{
  await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(22),payload({slot_id:id(5)})]));
  await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(23),payload({slot_id:id(6),tour_id:id(8),adults:1,children:0,expected_total:100})]));
  await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(24),payload({status:'HELD'})]));
  await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(25),payload({status:'PENDING'})]));
  await db.query("update bookings set payment_deadline=now()-interval '1 hour' where id=$1",[id(25)]);
  const result=await as(db,'authenticated',110,()=>rpc('get_operator_dashboard',[id(1),'2099-10-15T00:00Z','2099-10-16T00:00Z','2099-10-17T00:00Z','2099-10-08T00:00Z','2099-10-01T00:00Z','2099-10-15T06:00Z']));
  const shared=await as(db,'authenticated',110,()=>rpc('operator_departure_manifest',[id(1),'2099-10-14T22:00Z','2099-10-15T22:00Z']));
  assert.deepEqual(result.today_manifest.map(b=>b.id).sort(),shared.map(b=>b.id).sort());assert(!shared.some(b=>b.id===id(22)));assert(!shared.some(b=>b.id===id(25)));assert(shared.some(b=>b.status==='HELD'));assert.equal(result.tomorrow_manifest[0].id,id(22));
  await assert.rejects(as(db,'authenticated',112,()=>rpc('operator_departure_manifest',[id(1),'2099-10-14T22:00Z','2099-10-15T22:00Z'])),/Unauthorized/);
 });
 await check('simultaneous saves reuse existing locked capacity logic and never oversell',async()=>{
  await db.query('update slots set capacity_total=4,booked=0,held=0 where id=$1',[id(5)]);
  const other=new pg.Client({...config,database});await other.connect();
  try{
   const calls=await Promise.allSettled([as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(30),payload({slot_id:id(5)})])),as(other,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(31),payload({slot_id:id(5)})],other))]);
   assert.equal(calls.filter(r=>r.status==='fulfilled').length,1);const slot=(await db.query('select booked,held from slots where id=$1',[id(5)])).rows[0];assert.equal(slot.booked+slot.held,3);
  }finally{await other.end();}
 });
 await check('server-authoritative rounding, extras, promo and override permissions reconcile',async()=>{
  await db.query("update slots set capacity_total=100 where id=$1",[id(4)]);
  await db.query("insert into add_ons(id,business_id,name,price) values($1,$2,'Synthetic extra',12.35)",[id(90),id(1)]);
  const extra=payload({status:'PAID',adults:1,children:0,add_ons:{[id(90)]:2},expected_total:124.70});
  const r=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(40),extra]));assert.equal(r.total_captured,124.70);
  const override=payload({discount_type:'manual',override_total:99.99,discount_reason:'Synthetic approved adjustment',add_ons:{[id(90)]:1},expected_total:112.34});
  await assert.rejects(as(db,'authenticated',111,()=>rpc('create_operator_booking',[id(1),id(41),override])),/Admin permission/);
  const adjusted=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(41),override]));assert.equal(adjusted.total_amount,112.34);
  await db.query("insert into promotions(id,business_id,code,discount_type,discount_value,active,used_count) values($1,$2,'SYNTHETIC10','PERCENT',10,true,0)",[id(91),id(1)]);
  const discounted=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(42),payload({email:'promo@example.invalid',discount_type:'promo',promo_code:'SYNTHETIC10',expected_total:270})]));assert.equal(discounted.total_amount,270);
  assert.equal((await db.query('select count(*)::int n from promotion_uses where booking_id=$1',[id(42)])).rows[0].n,1);
 });
 await check('configured question types, per-participant scope and historical definitions are validated server-side',async()=>{
  const raw=[{key:'medical',label:'Safety answer',scope:'per_participant',type:'select',options:['None','Tell guide'],required:true},{key:'choice',label:'Equipment',type:'checkbox',options:['A','B']},{key:'number',label:'Measurement',type:'number',required:true},{key:'date',label:'Configured date',type:'date'},{key:'other',label:'Other activity only',tour_id:id(8),required:true},{key:'disabled',label:'Disabled',enabled:false,required:true}];
  await db.query('update businesses set booking_custom_fields=$1 where id=$2',[JSON.stringify(raw),id(1)]);
  const answer=fields(raw,{medical:['None','Tell guide','None'],choice:['A'],number:'0',date:'2099-10-15'});
  const good=payload({custom_fields:answer});
  for(const change of [{medical:['None']},{medical:['None','fake','None']},{choice:['A','A']},{choice:['fake']},{number:'NaN'},{date:'2026-02-30'},{__booking_questions:{...answer.__booking_questions,definitions:[]}}]){
   await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(44),{...good,custom_fields:{...answer,...change}}])));
  }
  await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(44),good]));
  const saved=(await db.query('select custom_fields from bookings where id=$1',[id(44)])).rows[0].custom_fields;
  assert.deepEqual(saved.medical,['None','Tell guide','None']);assert.equal(saved.number,'0');assert.equal(saved.__booking_questions.definitions[0].scope,'participant');assert.equal(saved.other,undefined);
  await db.query('update businesses set booking_custom_fields=$1 where id=$2',[JSON.stringify(simpleQuestions),id(1)]);
 });
 await check('manual upward/downward quotes survive checkout preparation without repricing or duplicate holds',async()=>{
  // Empty voucher fixture: no voucher creation/redemption/provider calls.
  await db.query("create table voucher_reservations(booking_id uuid,voucher_id uuid,amount numeric,status text)");
  for(const [n,amount] of [[45,450],[46,99.99]]){
   const r=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(n),payload({status:'PENDING',discount_type:'manual',override_total:amount,discount_reason:'Reviewed synthetic quote',expected_total:amount})]));assert.equal(r.total_amount,amount);
   assert.equal(Number((await db.query('select original_total from bookings where id=$1',[id(n)])).rows[0].original_total),Math.max(300,amount));
   for(let attempt=0;attempt<2;attempt++){
    const quote=await as(db,'service_role',110,()=>rpc('prepare_booking_checkout',[id(n),null,null,null,null]));assert.equal(quote.ok,true,quote.error);assert.equal(quote.amount,amount);
   }
   assert.equal((await db.query("select count(*)::int n from holds where booking_id=$1 and status='ACTIVE'",[id(n)])).rows[0].n,1);
   const changed=await as(db,'service_role',110,()=>rpc('prepare_booking_checkout',[id(n),'SYNTHETIC10',null,null,null]));assert.equal(changed.ok,false);assert.match(changed.error,/Review the operator price/);
  }
 });
 await check('invoice failure rolls back booking and capacity, then the same request safely retries',async()=>{
  await db.query("create function fixture_invoice_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic invoice failure';end$$;create trigger fixture_invoice_failure before insert on invoices for each row execute function fixture_invoice_failure()");
  const before=(await db.query('select booked,held from slots where id=$1',[id(4)])).rows[0];
  await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(43),payload()])),/Synthetic invoice failure/);
  assert.deepEqual((await db.query('select booked,held from slots where id=$1',[id(4)])).rows[0],before);
  assert.equal((await db.query('select count(*)::int n from bookings where id=$1',[id(43)])).rows[0].n,0);
  await db.query('drop trigger fixture_invoice_failure on invoices');assert.equal((await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(43),payload()]))).ok,true);
 });
 await check('cancellation distinguishes confirmed unpaid, partial, refunded and legacy paid money without issuing compensation',async()=>{
  await db.query("create function release_voucher_reservations(uuid) returns void language sql as $$select$$");
  for(const [n,status,captured,refunded,expected] of [[47,'CONFIRMED',0,0,0],[48,'CONFIRMED',100,0,100],[49,'CONFIRMED',100,100,0],[50,'PAID',0,0,300],[51,'PAID',450,0,450]]){
   await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(n),payload(n===51?{status,discount_type:'manual',override_total:450,discount_reason:'Synthetic surcharge',expected_total:450}:{status})]));
   await db.query('update bookings set total_captured=$1,total_refunded=$2 where id=$3',[captured,refunded,id(n)]);
   const before=(await db.query('select booked from slots where id=$1',[id(4)])).rows[0].booked;
   const result=await as(db,'service_role',110,()=>rpc('cancel_booking_transaction',[id(n),id(1),'Synthetic cancellation',true,true]));
   assert.equal(result.ok,true);assert.equal(result.refund_amount,expected);assert.equal(result.refund_action_required,expected>0);
   assert.equal((await db.query('select booked from slots where id=$1',[id(4)])).rows[0].booked,before-3);
   assert.equal((await as(db,'service_role',110,()=>rpc('cancel_booking_transaction',[id(n),id(1),'Synthetic retry',true,true]))).already_cancelled,true);
  }
 });
 await check('notify-only cancellation preserves money, releases capacity once and cannot be changed by retry',async()=>{
  await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,status,booked,held) values($1,$2,$3,now()+interval '1 hour',20,'OPEN',0,0)",[id(84),id(1),id(3)]);
  for(const [n,status,source,captured,voucher,expected] of [[80,'PAID','WEB',200,100,300],[81,'CONFIRMED','ADMIN',0,0,0],[82,'PAID','OTA_VIATOR',300,0,0]]){
   await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(n),payload({status,slot_id:id(84)})]));
   await db.query('update bookings set source=$1,total_captured=$2,voucher_amount_paid=$3,total_amount=$2,original_total=300 where id=$4',[source,captured,voucher,id(n)]);
   const before=(await db.query('select booked from slots where id=$1',[id(84)])).rows[0].booked;
   const result=await as(db,'service_role',110,()=>rpc('cancel_booking_transaction',[id(n),id(1),'Synthetic weather',true,true,false]));
   assert.equal(result.ok,true);assert.equal(result.refund_action_required,false);assert.equal(result.notification_only,true);assert.equal(result.refund_amount,expected);assert.equal(result.late_forfeit,false);
   const b=(await db.query('select status,cancellation_self_service,refund_amount,total_captured,voucher_amount_paid,converted_to_voucher_id,refund_notes from bookings where id=$1',[id(n)])).rows[0];
   assert.equal(b.status,'CANCELLED');assert.equal(b.cancellation_self_service,false);assert.equal(Number(b.total_captured),captured);assert.equal(Number(b.voucher_amount_paid),voucher);assert.equal(b.converted_to_voucher_id,null);
   if(expected){assert.equal(Number(b.refund_amount),expected);assert.match(b.refund_notes,/operator/);}
   assert.equal((await db.query('select booked from slots where id=$1',[id(84)])).rows[0].booked,before-3);
   assert.equal((await as(db,'service_role',110,()=>rpc('cancel_booking_transaction',[id(n),id(1),'Synthetic retry',true,true,true]))).already_cancelled,true);
   assert.equal((await db.query('select cancellation_self_service from bookings where id=$1',[id(n)])).rows[0].cancellation_self_service,false);
   assert.equal((await db.query('select booked from slots where id=$1',[id(84)])).rows[0].booked,before-3);
  }
  await assert.rejects(as(db,'authenticated',110,()=>rpc('cancel_booking_transaction',[id(80),id(1),'Not allowed',true,true,false])),/permission denied/);
  const wrong=await as(db,'service_role',110,()=>rpc('cancel_booking_transaction',[id(80),id(2),'Wrong tenant',true,true,false]));assert.equal(wrong.ok,false);
 });
 await check('existing expiry policy releases an expired hold exactly once',async()=>{
  const cancellation=readFileSync('supabase/migrations/20260911150000_booking_cancellation.sql','utf8');
  await db.query(cancellation.slice(cancellation.indexOf('CREATE OR REPLACE FUNCTION public.expire_single_hold'),cancellation.lastIndexOf('COMMIT;')));
  const before=(await db.query('select held from slots where id=$1',[id(4)])).rows[0].held;
  await db.query("update holds set expires_at=now()-interval '10 minutes' where booking_id=$1",[id(24)]);
  const hold=(await db.query('select id from holds where booking_id=$1',[id(24)])).rows[0].id;
  assert.equal((await rpc('expire_single_hold',[hold])).expired,true);assert.equal((await rpc('expire_single_hold',[hold])).already,'EXPIRED');
  assert.equal((await db.query('select held from slots where id=$1',[id(4)])).rows[0].held,before-3);
 });
 await check('the shared browser fixture reconciles exact Thursday/Friday IDs and participant totals in SQL',async()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/operator-day.json','utf8'));
  await db.query('truncate bookings cascade');
  for(const slot of fixture.slots)await db.query(`insert into slots(id,business_id,tour_id,start_time,capacity_total,booked,held,status)
   values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set start_time=excluded.start_time,capacity_total=excluded.capacity_total,booked=excluded.booked,held=excluded.held`,[slot.id,slot.business_id,slot.tour_id,slot.start_time,slot.capacity_total,slot.booked,slot.held,slot.status]);
  for(const b of fixture.bookings){
   // The browser freezes its clock; SQL holds must also stay active when this dated fixture runs later.
   const deadline=b.payment_deadline?new Date(Date.now()+86_400_000).toISOString():null;
   await db.query(`insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,phone,qty,status,total_amount,total_captured,unit_price,waiver_status,payment_deadline,party_composition,allow_unpaid,ota_channel)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,100,$12,$13,$14::jsonb,$15,$16)`,[b.id,b.business_id,b.tour_id,b.id===id(27)?id(4):b.slot_id,b.customer_name,b.email,b.phone,b.qty,b.status,b.total_amount,b.total_captured,b.waiver_status,deadline,JSON.stringify(b.party_composition),b.allow_unpaid,b.ota_channel]);
   if(b.id===id(27))await db.query('update bookings set slot_id=$1 where id=$2',[b.slot_id,b.id]);
  }
  const args=[id(1),'2026-10-15T00:00Z','2026-10-16T00:00Z','2026-10-17T00:00Z','2026-10-08T00:00Z','2026-10-01T00:00Z','2026-10-15T05:00Z'];
  const full=await as(db,'authenticated',110,()=>rpc('get_operator_dashboard',args));
  const simple=await as(db,'authenticated',110,()=>rpc('operator_departure_manifest',[id(1),'2026-10-14T22:00Z','2026-10-15T22:00Z']));
  assert.deepEqual(full.today_manifest.map(b=>b.id).sort(),simple.map(b=>b.id).sort());assert.equal(simple.reduce((n,b)=>n+b.qty,0),14);
  assert.equal(full.tomorrow_manifest[0].id,id(27));assert(!simple.some(b=>b.id===id(27)));assert(!simple.some(b=>b.id===id(26)));
  args[6]='2026-10-15T22:30Z';const midnight=await as(db,'authenticated',110,()=>rpc('get_operator_dashboard',args));assert.deepEqual(midnight.today_manifest.map(b=>b.id),[id(27)]);
 });
 await check('server day boundaries cover 23-hour and 25-hour operator days',async()=>{
  await db.query("update businesses set timezone='America/New_York' where id=$1",[id(1)]);
  await db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,status,total_amount,total_captured,unit_price) values($1,$2,$3,$4,'DST synthetic','dst@example.invalid',1,'PAID',100,100,100)",[id(28),id(1),id(3),id(7)]);
  for(const [now,before,inside,late,expected] of [
   ['2026-03-08T12:00Z','2026-03-08T04:30Z','2026-03-08T07:30Z','2026-03-09T04:15Z',[id(25)]],
   ['2026-11-01T12:00Z','2026-11-01T03:30Z','2026-11-01T06:30Z','2026-11-02T04:30Z',[id(25),id(28)]]]){
    await db.query('update slots set start_time=$1 where id=$2',[before,id(4)]);await db.query('update slots set start_time=$1 where id=$2',[inside,id(6)]);await db.query('update slots set start_time=$1 where id=$2',[late,id(7)]);
    const full=await as(db,'authenticated',110,()=>rpc('get_operator_dashboard',[id(1),now,now,now,now,now,now]));assert.deepEqual(full.today_manifest.map(b=>b.id).sort(),expected.sort());
   }
 });
 await db.query("update businesses set timezone='Africa/Johannesburg',booking_custom_fields='[]' where id=$1",[id(1)]);
 const extraTour='00000000-0000-0000-0000-000000000001';
 const bespoke=(changes={})=>payload({tour_id:extraTour,slot_id:null,departure_override:true,departure_local:'2020-01-02T00:15:00',adults:120,children:5,status:'CONFIRMED',discount_type:'manual',override_total:4321.09,discount_reason:'Extra pax',expected_total:4321.09,custom_fields:fields([],{},extraTour),...changes});
 await check('extra pax has no 50-person limit, accepts past departures and exact totals, appears in the manifest, and retries once',async()=>{
  const p=bespoke();const r=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(300),p]));
  assert.equal(r.qty,125);assert.equal(r.total_amount,4321.09);assert.equal(r.total_captured,0);assert.equal(r.status,'CONFIRMED');assert.equal(new Date(r.start_time).toISOString(),'2020-01-01T22:15:00.000Z');
  const tour=(await db.query('select name,active,hidden,is_extra_pax from tours where id=$1',[r.tour_id])).rows[0];assert.deepEqual(tour,{name:'Extra pax',active:false,hidden:true,is_extra_pax:true});
  const slot=(await db.query('select status,booked,held from slots where id=$1',[r.slot_id])).rows[0];assert.deepEqual(slot,{status:'CLOSED',booked:125,held:0});
  const roster=await as(db,'authenticated',110,()=>rpc('operator_departure_manifest',[id(1),'2020-01-01T22:00Z','2020-01-02T22:00Z']));assert.equal(roster.find(b=>b.id===id(300)).qty,125);
  assert.equal((await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(300),p]))).replay,true);
  assert.equal((await db.query('select booked from slots where id=$1',[r.slot_id])).rows[0].booked,125);
  await db.query(`create function public.current_guide_business() returns uuid language sql as $$select '${id(1)}'::uuid$$`);
  const guideSql=readFileSync('supabase/migrations/20261015200000_guide_simple_manifest.sql','utf8');
  await db.query(guideSql.slice(guideSql.indexOf('create function public.guide_simple_day'),guideSql.indexOf('revoke all on function public.guide_simple_day')));
  const guideDay=await as(db,'authenticated',110,()=>rpc('guide_simple_day',['2020-01-02']));assert.equal(guideDay.departures[0].booked_guests,125);assert.equal(guideDay.departures[0].bookings[0].id,id(300));
  const invoice=(await db.query('select qty,total_amount,tour_name from invoices where booking_id=$1',[id(300)])).rows[0];assert.equal(invoice.qty,125);assert.equal(Number(invoice.total_amount),4321.09);assert.equal(invoice.tour_name,'Extra pax');
  for(let i=0;i<2;i++){const quote=await as(db,'service_role',110,()=>rpc('prepare_booking_checkout',[id(300),null,null,null,null]));assert.equal(quote.ok,true,quote.error);assert.equal(quote.amount,4321.09);}
  const mismatch=await as(db,'service_role',110,()=>rpc('confirm_booking_payment',[id(300),'synthetic-payment',432100,'ZAR']));assert.equal(mismatch.error,'amount_mismatch');
  const paid=await as(db,'service_role',110,()=>rpc('confirm_booking_payment',[id(300),'synthetic-payment',432109,'ZAR']));assert.equal(paid.ok,true,paid.error);
  assert.equal((await as(db,'service_role',110,()=>rpc('confirm_booking_payment',[id(300),'synthetic-payment',432109,'ZAR']))).already_paid,true);
  assert.equal((await as(db,'service_role',110,()=>rpc('account_manual_booking',[id(300),id(1),true,'Cash']))).ok,true);
  assert.equal(Number((await db.query('select total_captured from bookings where id=$1',[id(300)])).rows[0].total_captured),4321.09);
  const free=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(301),bespoke({override_total:0,expected_total:0,status:'PAID'})]));assert.equal(free.total_amount,0);assert.equal(free.tour_id,r.tour_id);assert.equal(free.slot_id,r.slot_id);
 });
 await check('only writable same-tenant admins can override, malformed price/count/date and temporary holds fail atomically',async()=>{
  for(const user of [111,112,113])await assert.rejects(as(db,'authenticated',user,()=>rpc('create_operator_booking',[id(1),id(302),bespoke()])));
  for(const change of [{adults:0,children:0},{adults:1.5},{adults:2147483647,children:1},{override_total:-1},{override_total:'NaN'},{override_total:'Infinity'},{expected_total:12},{departure_local:'2020-02-30T12:00:00'},{departure_local:'garbage'},{status:'PENDING'},{status:'HELD'},{tour_id:id(999)},{discount_type:'none'}]){
   await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(302),bespoke(change)])));
  }
  assert.equal((await db.query('select count(*)::int n from bookings where id=$1',[id(302)])).rows[0].n,0);
  await db.query("update businesses set timezone='America/New_York' where id=$1",[id(1)]);
  await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(302),bespoke({departure_local:'2026-03-08T02:30:00'})])),/does not exist/);
  await db.query("update businesses set timezone='Africa/Johannesburg' where id=$1",[id(1)]);
 });
 await check('existing full departures accept admin extra capacity without moving other guests or losing held seats',async()=>{
  await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,status,booked,held) values($1,$2,$3,'2099-12-01T08:00Z',10,'OPEN',7,3)",[id(310),id(1),id(3)]);
  const p=bespoke({tour_id:id(3),departure_local:'2099-12-01T10:00:00',custom_fields:fields([],{},id(3))});
  const r=await as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(311),p]));assert.equal(r.slot_id,id(310));
  const slot=(await db.query('select status,booked,held,capacity_total from slots where id=$1',[id(310)])).rows[0];assert.deepEqual(slot,{status:'OPEN',booked:132,held:3,capacity_total:135});
  const normal=payload({slot_id:id(310),adults:51,children:0,expected_total:5100,custom_fields:fields([],{},id(3))});
  await assert.rejects(as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(312),normal])),/guest count/);
 });
 await check('manual deadlines, holds and payment reminders stay aligned and revalidate payment',async()=>{
  await db.query('alter table voucher_reservations add column if not exists business_id uuid, add column if not exists expires_at timestamptz');
  await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,status,booked,held) values($1,$2,$3,now()+interval '30 days',100,'OPEN',0,0)",[id(400),id(1),id(3)]);
  const make=async(n,extra={})=>as(db,'authenticated',110,()=>rpc('create_operator_booking',[id(1),id(n),payload({slot_id:id(400),status:'PENDING',hold_hours:168,custom_fields:fields([],{},id(3)),...extra})]));
  const created=await make(401);assert.equal(created.ok,true);
  const actual=(await db.query("select b.payment_deadline,h.expires_at, b.payment_deadline between now()+interval '167 hours' and now()+interval '169 hours' correct from bookings b join holds h on h.booking_id=b.id where b.id=$1",[id(401)])).rows[0];
  assert(actual.correct);assert.equal(actual.payment_deadline.toISOString(),actual.expires_at.toISOString());
  await db.query("update bookings set payment_url='https://checkout.yoco.com/fixture' where id=$1",[id(401)]);
  await as(db,'service_role',110,()=>rpc('prepare_payment_recovery',[id(401),id(1)]));
  assert.equal((await db.query('select payment_deadline from bookings where id=$1',[id(401)])).rows[0].payment_deadline.toISOString(),actual.payment_deadline.toISOString(),'resend must not shorten seven-day deadline');
  assert.equal(await as(db,'service_role',110,()=>rpc('enqueue_manual_payment_reminders',[100])),0);
  await db.query("update bookings set created_at=now()-interval '6 days',payment_deadline=now()+interval '24 hours' where id=$1",[id(401)]);
  assert.equal(await as(db,'service_role',110,()=>rpc('enqueue_manual_payment_reminders',[100])),1);
  assert.equal(await as(db,'service_role',110,()=>rpc('enqueue_manual_payment_reminders',[100])),0,'no duplicate reminders');
  const jobs=await as(db,'service_role',110,()=>db.query('select * from claim_notification_jobs($1,100,25)',[id(490)]).then(r=>r.rows));
  const job=jobs.find(j=>j.booking_id===id(401));assert(job);
  assert.equal(await as(db,'service_role',110,()=>rpc('validate_notification_job',[job.id,id(490)])),'ELIGIBLE');
  await db.query("update bookings set total_captured=total_amount,status='PAID' where id=$1",[id(401)]);
  assert.equal(await as(db,'service_role',110,()=>rpc('validate_notification_job',[job.id,id(490)])),'CANCELLED');
  for(const [n,change] of [[402,"status='CANCELLED'"],[403,"payment_deadline=now()+interval '2 days'"],[404,"allow_unpaid=true"],[405,"email='changed@example.invalid'"]]){
   await make(n);await db.query("update bookings set created_at=now()-interval '6 days',payment_deadline=now()+interval '23 hours',payment_url='https://checkout.yoco.com/fixture' where id=$1",[id(n)]);
   assert.equal(await as(db,'service_role',110,()=>rpc('enqueue_manual_payment_reminders',[100])),1);
   const claimed=await as(db,'service_role',110,()=>db.query('select * from claim_notification_jobs($1,100,25)',[id(490)]).then(r=>r.rows));const j=claimed.find(j=>j.booking_id===id(n));assert(j);
   await db.query('update bookings set '+change+' where id=$1',[id(n)]);
   assert.equal(await as(db,'service_role',110,()=>rpc('validate_notification_job',[j.id,id(490)])),'CANCELLED');
  }
  await db.query("update slots set start_time=now()+interval '2 days' where id=$1",[id(400)]);
  await make(406);
  const cap=(await db.query("select b.payment_deadline=s.start_time-interval '1 hour' capped from bookings b join slots s on s.id=b.slot_id where b.id=$1",[id(406)])).rows[0];assert(cap.capped);
  await assert.rejects(as(db,'authenticated',110,()=>rpc('enqueue_manual_payment_reminders',[100])),/permission denied/);
 });
 console.log(`PASS ${passed} local PostgreSQL acceptance groups; synthetic data only; zero provider calls`);
}finally{
 await db.end().catch(()=>{});if(created)await admin.query('drop database '+database+' with (force)');await admin.end();
}
