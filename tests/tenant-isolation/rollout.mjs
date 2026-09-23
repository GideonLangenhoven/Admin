import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { checkPaymentFlows } from './payment-flows.mjs';

// Deliberately never loads .env.local or accepts a production connection URL.
const host = process.env.ROLLOUT_TEST_HOST || process.argv[2] || '127.0.0.1';
assert(['127.0.0.1', 'localhost', '::1'].includes(host) || /^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host), 'Database tests require a disposable local PostgreSQL server');
const connection = { host, port: Number(process.env.ROLLOUT_TEST_PORT || 5432), user: process.env.ROLLOUT_TEST_USER || process.env.USER, password: process.env.ROLLOUT_TEST_PASSWORD };
const database = 'rollout_' + randomBytes(8).toString('hex');
const admin = new pg.Client({ ...connection, database: 'postgres' });
const db = new pg.Client({ ...connection, database });
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let passed = 0;
let connected = false;

async function as(role, user, headers, work) {
  await db.query('begin');
  try {
    assert(['anon', 'authenticated', 'service_role'].includes(role));
    await db.query('set local role ' + role);
    await db.query("select set_config('request.jwt.claims',$1,true), set_config('request.jwt.claim.role','',true), set_config('request.jwt.claim.sub','',true), set_config('request.headers',$2,true)", [JSON.stringify({role,sub:user?id(user):null}), JSON.stringify(headers)]);
    await work();
  } finally { await db.query('rollback'); }
}
async function check(name, work) { await work(); passed++; console.log('PASS ' + name); }

try {
  await admin.connect();
  await admin.query('create database ' + database);
  await db.connect(); connected = true;
  await db.query(readFileSync('tests/fixtures/rollout-schema.sql', 'utf8'));
  await db.query(readFileSync('tests/fixtures/rollout-policies.sql', 'utf8'));
  await db.query(readFileSync('tests/fixtures/rollout-marketing.sql', 'utf8'));
  await db.query(readFileSync('tests/fixtures/rollout-cron.sql', 'utf8'));
  await db.query(readFileSync('tests/fixtures/rollout-platform.sql', 'utf8'));
  // The July public-settings policy exists in the deployed catalog but not in
  // the older schema snapshot; apply its real source before September changes.
  await db.query(readFileSync('supabase/migrations/20260724150000_operator_directory.sql', 'utf8'));
  await db.query('grant select on public.platform_public_settings to anon');
  await db.query('grant select,insert,update,delete on public.platform_public_settings to authenticated');
  await db.query("create function public.ck_current_period_key() returns date language sql stable as 'select current_date'");
  await db.query(readFileSync('supabase/migrations/20260302123000_subscription_line_items.sql', 'utf8'));
  const platformInvoiceSchema = readFileSync('supabase/migrations/20260714172241_platform_invoices.sql', 'utf8');
  // Use the actual invoice schema and grants, without the unrelated encryption RPCs.
  await db.query(platformInvoiceSchema.slice(0, platformInvoiceSchema.indexOf('-- ── RPC:')) + '\nCOMMIT;');
  await db.query(readFileSync('supabase/migrations/20260717092131_platform_invoice_email_overage.sql', 'utf8'));
  await db.query(readFileSync('supabase/migrations/20260805081024_ai_overage_invoice_and_5000_allowance.sql', 'utf8'));
  // Use the real policy calculator for customer/operator refund positive paths.
  const refundPolicy = readFileSync('supabase/migrations/20260504000000_refund_policy.sql', 'utf8');
  await db.query(refundPolicy.slice(refundPolicy.indexOf('CREATE OR REPLACE FUNCTION public.calculate_refund_percent'), refundPolicy.indexOf('CREATE OR REPLACE FUNCTION public.calculate_booking_refund')));
  const existingPricingBusiness = id(900001);
  const futurePricingBusiness = id(900002);
  await db.query("update plans set name='Legacy Standard',monthly_price_zar=1400,setup_fee_zar=3500,extra_seat_price_zar=250 where id='standard'");
  await db.query("insert into businesses(id,name,operator_email,subscription_status) values ($1,'Existing pricing fixture','existing-pricing@example.invalid','ACTIVE'),($2,'Future pricing fixture','future-pricing@example.invalid','ACTIVE')", [existingPricingBusiness, futurePricingBusiness]);
  await db.query("insert into subscriptions(business_id,plan_id,status,period_start) values($1,'standard','ACTIVE','2026-08-01')", [existingPricingBusiness]);
  const existingPricingSnapshot = (await db.query(`
    select jsonb_build_object(
      'plan',(select to_jsonb(p) from plans p where id='standard'),
      'subscription',(select to_jsonb(s) from subscriptions s where business_id=$1),
      'lines',(select jsonb_agg(to_jsonb(li) order by li.kind,li.id) from billing_line_items li where business_id=$1)
    ) snapshot`, [existingPricingBusiness])).rows[0].snapshot;
  await db.query(`
    insert into businesses(id,name,operator_email,subscription_status)
    select
      ('00000000-0000-4000-8000-' || lpad((900100 + g)::text,12,'0'))::uuid,
      'Continuity business ' || g,
      'continuity-business-' || g || '@example.invalid',
      'ACTIVE'
    from generate_series(1,34) g
  `);
  await db.query(`
    insert into admin_users(id,user_id,business_id,email,password_hash,role,name,settings_permissions,suspended)
    select
      ('00000000-0000-4000-8000-' || lpad((901000 + g)::text,12,'0'))::uuid,
      ('00000000-0000-4000-8000-' || lpad((902000 + g)::text,12,'0'))::uuid,
      ('00000000-0000-4000-8000-' || lpad((900100 + ceil(g / 3.0)::int)::text,12,'0'))::uuid,
      'continuity-' || g || '@example.invalid',
      'legacy-hash-' || g,
      (array['OPERATOR','ADMIN','MAIN_ADMIN'])[1 + ((g - 1) % 3)],
      'Continuity user ' || g,
      jsonb_build_object('reports', (g % 2 = 0), 'settings', (g % 3 = 0)),
      false
    from generate_series(1,100) g
  `);
  const continuitySnapshot = (await db.query(`
    select jsonb_agg(
      jsonb_build_object(
        'id', id, 'user_id', user_id, 'business_id', business_id, 'email', email,
        'password_hash', password_hash, 'role', role, 'name', name,
        'settings_permissions', settings_permissions, 'suspended', suspended
      ) order by email
    ) snapshot
    from admin_users
    where email like 'continuity-%@example.invalid'
  `)).rows[0].snapshot;
  for (const file of readdirSync('supabase/migrations').filter(x => /^\d{14}_.*\.sql$/.test(x) && x >= '20260907071000_').sort()) {
    await db.query(readFileSync('supabase/migrations/' + file, 'utf8'));
    console.log('APPLIED ' + file);
  }
  await check('100 pre-existing staff accounts preserve identity, Auth links, roles, and settings across the migration ledger', async()=>{
    const result = await db.query(`
      select count(*)::int count, jsonb_agg(
        jsonb_build_object(
          'id', id, 'user_id', user_id, 'business_id', business_id, 'email', email,
          'password_hash', password_hash, 'role', role, 'name', name,
          'settings_permissions', settings_permissions, 'suspended', suspended
        ) order by email
      ) snapshot
      from admin_users
      where email like 'continuity-%@example.invalid'
    `);
    assert.equal(result.rows[0].count,100);
    assert.deepEqual(result.rows[0].snapshot,continuitySnapshot);
    assert.equal((await db.query(`
      select count(*)::int count
      from mfa_recovery_state r
      join admin_users a on a.id=r.admin_id
      where a.email like 'continuity-%@example.invalid'
    `)).rows[0].count,0);
  });
  await check('setup-token claim functions are service-only',async()=>{
    for(const role of ['anon','authenticated']) {
      const privileges=(await db.query(`select
        has_function_privilege($1,'public.issue_admin_setup_token(uuid,text,timestamptz,boolean)','EXECUTE') issue,
        has_function_privilege($1,'public.claim_admin_setup_token(text,text,uuid)','EXECUTE') claim,
        has_function_privilege($1,'public.complete_admin_setup_token(uuid,text,uuid,uuid)','EXECUTE') complete,
        has_function_privilege($1,'public.release_admin_setup_token_claim(uuid,uuid)','EXECUTE') release`,[role])).rows[0];
      assert.deepEqual(privileges,{issue:false,claim:false,complete:false,release:false});
    }
    assert.equal((await db.query("select has_function_privilege('service_role','public.issue_admin_setup_token(uuid,text,timestamptz,boolean)','EXECUTE') allowed")).rows[0].allowed,true);
    assert.equal((await db.query("select has_function_privilege('service_role','public.claim_admin_setup_token(text,text,uuid)','EXECUTE') allowed")).rows[0].allowed,true);
  });
  await check('setup-token rotation respects an active claim and a claimed token can finish after expiry',async()=>{
    const adminId=id(901003);
    const tokenHash='claimed-token-hash';
    const replacementHash='replacement-token-hash';
    const claimId=id(903006);
    await db.query(`update admin_users set setup_token_hash=$2,
      setup_token_expires_at=now()+interval '1 hour',setup_token_claim_id=null,
      setup_token_claimed_at=null where id=$1`,[adminId,tokenHash]);
    assert.equal((await db.query(
      'select claim_admin_setup_token($1,$2,$3) result',
      ['continuity-3@example.invalid',tokenHash,claimId],
    )).rows[0].result.status,'CLAIMED');
    assert.equal((await db.query(
      "select issue_admin_setup_token($1,$2,now()+interval '2 hours',true) result",
      [adminId,replacementHash],
    )).rows[0].result.status,'BUSY');
    assert.equal((await db.query('select setup_token_hash from admin_users where id=$1',[adminId])).rows[0].setup_token_hash,tokenHash);
    await db.query("update admin_users set setup_token_expires_at=now()-interval '1 second' where id=$1",[adminId]);
    assert.equal((await db.query(
      'select complete_admin_setup_token($1,$2,$3,$4) completed',
      [adminId,tokenHash,claimId,id(902003)],
    )).rows[0].completed,true);
  });
  await check('only one concurrent setup-token claim reaches password mutation',async()=>{
    const adminId=id(901001);
    const tokenHash='setup-token-hash';
    const claimIds=[id(903001),id(903002)];
    await db.query(`update admin_users set
      password_hash='legacy-hash',must_set_password=true,setup_token_hash=$2,
      setup_token_expires_at=now()+interval '1 hour',setup_token_hash_used=null,
      setup_token_claim_id=null,setup_token_claimed_at=null
      where id=$1`,[adminId,tokenHash]);
    const clients=[new pg.Client({...connection,database}),new pg.Client({...connection,database})];
    try {
      await Promise.all(clients.map(client=>client.connect().then(()=>client.query('set role service_role'))));
      const claims=await Promise.all(clients.map((client,index)=>client.query(
        'select claim_admin_setup_token($1,$2,$3) result',
        ['continuity-1@example.invalid',tokenHash,claimIds[index]],
      )));
      const results=claims.map(result=>result.rows[0].result);
      assert.equal(results.filter(result=>result.status==='CLAIMED').length,1);
      assert.equal(results.filter(result=>result.status==='BUSY').length,1);
      const winningIndex=results.findIndex(result=>result.status==='CLAIMED');
      assert.equal((await clients[winningIndex].query(
        'select complete_admin_setup_token($1,$2,$3,$4) completed',
        [adminId,tokenHash,claimIds[winningIndex],id(902001)],
      )).rows[0].completed,true);
      const row=(await db.query(`select user_id,password_hash,must_set_password,setup_token_hash,
        setup_token_hash_used,setup_token_claim_id from admin_users where id=$1`,[adminId])).rows[0];
      assert.deepEqual(row,{
        user_id:id(902001),password_hash:null,must_set_password:false,setup_token_hash:null,
        setup_token_hash_used:tokenHash,setup_token_claim_id:null,
      });
      assert.equal((await clients[1-winningIndex].query(
        'select claim_admin_setup_token($1,$2,$3) result',
        ['continuity-1@example.invalid',tokenHash,claimIds[1-winningIndex]],
      )).rows[0].result.status,'COMPLETED');
    } finally { await Promise.all(clients.map(client=>client.end())); }
  });
  await check('a failed setup attempt can release only its own claim',async()=>{
    const adminId=id(901002);
    const tokenHash='retryable-setup-token-hash';
    const claimId=id(903003);
    await db.query(`update admin_users set setup_token_hash=$2,
      setup_token_expires_at=now()+interval '1 hour',setup_token_claim_id=null,
      setup_token_claimed_at=null where id=$1`,[adminId,tokenHash]);
    assert.equal((await db.query(
      'select claim_admin_setup_token($1,$2,$3) result',
      ['continuity-2@example.invalid',tokenHash,claimId],
    )).rows[0].result.status,'CLAIMED');
    assert.equal((await db.query(
      'select release_admin_setup_token_claim($1,$2) released',
      [adminId,id(903004)],
    )).rows[0].released,false);
    assert.equal((await db.query(
      'select release_admin_setup_token_claim($1,$2) released',
      [adminId,claimId],
    )).rows[0].released,true);
    assert.equal((await db.query(
      'select claim_admin_setup_token($1,$2,$3) result',
      ['continuity-2@example.invalid',tokenHash,id(903005)],
    )).rows[0].result.status,'CLAIMED');
  });
  await check('notification jobs and claims are service-only',async()=>{
    for(const role of ['anon','authenticated']) {
      const privileges=(await db.query(`select
        has_table_privilege($1,'public.notification_jobs','SELECT') table_select,
        has_function_privilege($1,'public.claim_notification_jobs(uuid,integer,integer)','EXECUTE') claim,
        has_function_privilege($1,'public.validate_notification_job(uuid,uuid)','EXECUTE') validate,
        has_function_privilege($1,'public.finish_notification_job(uuid,uuid,boolean,text,text,boolean,boolean)','EXECUTE') finish,
        has_function_privilege($1,'public.enqueue_voucher_payment_reminder(uuid)','EXECUTE') enqueue,
        has_function_privilege($1,'public.enqueue_voucher_payment_reminders(integer,integer)','EXECUTE') enqueue_batch,
        has_function_privilege($1,'public.retry_notification_job(uuid,uuid,uuid)','EXECUTE') retry`,[role])).rows[0];
      assert.deepEqual(privileges,{table_select:false,claim:false,validate:false,finish:false,enqueue:false,enqueue_batch:false,retry:false});
    }
    assert.equal((await db.query("select has_function_privilege('service_role','public.claim_notification_jobs(uuid,integer,integer)','EXECUTE') allowed")).rows[0].allowed,true);
  });
  await check('notification jobs have an authenticated one-minute capacity schedule',async()=>{
    const job=(await db.query("select schedule,command from cron.job where jobname='notification-jobs-every-minute'")).rows[0];
    assert.equal(job.schedule,'* * * * *');
    assert.match(job.command,/https:\/\/fixture\.invalid\/functions\/v1\/cron-tasks/);
    assert.match(job.command,/edge_jobs_service_role_key/);
    assert.match(job.command,/\{"action":"notification_jobs"\}/);
    assert.match(job.command,/timeout_milliseconds := 55000/);
  });
  await check('hold expiry and voucher reminder commit durable deduplicated intent',async()=>{
    const businessId=id(900101);
    const tourId=id(904010),slotId=id(904011),bookingId=id(904012),holdId=id(904013),voucherId=id(904014);
    await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values($1,$2,'Reminder tour',100,10)",[tourId,businessId]);
    await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,held) values($1,$2,$3,now()+interval '1 day',10,1)",[slotId,businessId,tourId]);
    await db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status,payment_url,yoco_checkout_id) values($1,$2,$3,$4,'Reminder guest','reminder@example.invalid',1,100,100,'HELD','https://pay.example.invalid/booking','booking-checkout-old')",[bookingId,businessId,tourId,slotId]);
    await db.query("insert into holds(id,booking_id,slot_id,qty,status,expires_at) values($1,$2,$3,1,'ACTIVE',now()-interval '10 minutes')",[holdId,bookingId,slotId]);
    assert.equal((await db.query('select expire_single_hold($1) result',[holdId])).rows[0].result.ok,true);
    assert.equal((await db.query("select count(*)::int count from notification_jobs where dedupe_key like $1",['hold-payment-link/'+holdId+'/%'])).rows[0].count,1);
    assert.equal((await db.query('select expire_single_hold($1) result',[holdId])).rows[0].result.already,'EXPIRED');
    assert.equal((await db.query("select count(*)::int count from notification_jobs where dedupe_key like $1",['hold-payment-link/'+holdId+'/%'])).rows[0].count,1);
    await db.query("update bookings set payment_url='https://pay.example.invalid/booking-new',yoco_checkout_id='booking-checkout-new',email='reminder-new@example.invalid' where id=$1",[bookingId]);
    assert.deepEqual((await db.query("select status,count(*)::int count from notification_jobs where source_id=$1 group by status order by status",[holdId])).rows,[
      {status:'CANCELLED',count:1},{status:'QUEUED',count:1},
    ]);
    assert.deepEqual((await db.query("select recipient,payload->>'payment_url' payment_url,payload->>'yoco_checkout_id' yoco_checkout_id from notification_jobs where source_id=$1 and status='QUEUED'",[holdId])).rows[0],{
      recipient:'reminder-new@example.invalid',payment_url:'https://pay.example.invalid/booking-new',yoco_checkout_id:'booking-checkout-new',
    });

    await db.query("insert into vouchers(id,business_id,code,current_balance,value,status,buyer_email,buyer_name,recipient_name,tour_name,payment_url,created_at) values($1,$2,'DURABLE1',100,100,'PENDING','buyer@example.invalid','Buyer','Guest','Reminder tour','https://pay.example.invalid/voucher',now()-interval '20 minutes')",[voucherId,businessId]);
    assert.equal((await db.query('select enqueue_voucher_payment_reminder($1) result',[voucherId])).rows[0].result.status,'QUEUED');
    assert.equal((await db.query('select enqueue_voucher_payment_reminder($1) result',[voucherId])).rows[0].result.status,'ALREADY_QUEUED');
    assert.equal((await db.query("select count(*)::int count from notification_jobs where source_id in ($1,$2)",[holdId,voucherId])).rows[0].count,3);
    await db.query("update vouchers set created_at=now()-interval '25 hours' where id=$1",[voucherId]);
    assert.equal((await db.query('select cleanup_abandoned_voucher($1) cleaned',[voucherId])).rows[0].cleaned,false);
  });
  await check('notification claim recovery, retry and acceptance preserve state',async()=>{
    const businessId=id(900101),voucherId=id(904014);
    const firstClaim=id(904020),recoveryClaim=id(904021);
    const claimed=(await db.query('select * from claim_notification_jobs($1,10,5)',[firstClaim])).rows;
    assert.equal(claimed.length,2);
    const voucherJob=claimed.find(job=>job.source_type==='VOUCHER_PAYMENT_REMINDER');
    const holdJob=claimed.find(job=>job.source_type==='HOLD_PAYMENT_REMINDER');
    assert(voucherJob&&holdJob);
    assert.equal((await db.query('select finish_notification_job($1,$2,true,$3,null,false,false) result',[voucherJob.id,firstClaim,'provider-voucher'])).rows[0].result,'ACCEPTED');
    assert((await db.query('select payment_reminder_sent_at from vouchers where id=$1',[voucherId])).rows[0].payment_reminder_sent_at);
    await db.query("update notification_jobs set claimed_at=now()-interval '6 minutes' where id=$1",[holdJob.id]);
    const recovered=(await db.query('select * from claim_notification_jobs($1,10,5)',[recoveryClaim])).rows;
    assert.equal(recovered.length,1);
    assert.equal(recovered[0].id,holdJob.id);
    assert.equal(recovered[0].attempts,2);
    assert.equal((await db.query('select finish_notification_job($1,$2,false,null,$3,true,true) result',[holdJob.id,recoveryClaim,'timeout'])).rows[0].result,'QUEUED');
    assert.deepEqual((await db.query('select status,claim_id,last_error from notification_jobs where id=$1',[holdJob.id])).rows[0],{status:'QUEUED',claim_id:null,last_error:'timeout'});
    assert.equal((await db.query('select count(*)::int count from notification_jobs where business_id=$1',[businessId])).rows[0].count,3);

    await db.query("update bookings set status='PAID' where id=$1",[id(904012)]);
    assert.equal((await db.query('select status from notification_jobs where id=$1',[holdJob.id])).rows[0].status,'CANCELLED');
    const cancelledVoucherId=id(904015);
    await db.query("insert into vouchers(id,business_id,code,current_balance,value,status,buyer_email,payment_url) values($1,$2,'DURABLE2',100,100,'PENDING','buyer2@example.invalid','https://pay.example.invalid/voucher2')",[cancelledVoucherId,businessId]);
    assert.equal((await db.query('select enqueue_voucher_payment_reminder($1) result',[cancelledVoucherId])).rows[0].result.status,'QUEUED');
    await db.query("update vouchers set status='ACTIVE' where id=$1",[cancelledVoucherId]);
    assert.equal((await db.query('select status from notification_jobs where source_id=$1',[cancelledVoucherId])).rows[0].status,'CANCELLED');

    const changedVoucherId=id(904030);
    await db.query("insert into vouchers(id,business_id,code,current_balance,value,status,buyer_email,payment_url,yoco_checkout_id,created_at) values($1,$2,'DURABLE3',100,100,'PENDING','old@example.invalid','https://pay.example.invalid/old','voucher-checkout-old',now()-interval '20 minutes')",[changedVoucherId,businessId]);
    assert.equal((await db.query('select enqueue_voucher_payment_reminder($1) result',[changedVoucherId])).rows[0].result.status,'QUEUED');
    await db.query("update vouchers set buyer_email='new@example.invalid',payment_url='https://pay.example.invalid/new',yoco_checkout_id='voucher-checkout-new' where id=$1",[changedVoucherId]);
    assert.equal((await db.query("select status from notification_jobs where source_id=$1 order by created_at limit 1",[changedVoucherId])).rows[0].status,'CANCELLED');
    assert.equal((await db.query('select enqueue_voucher_payment_reminders(10,2) queued')).rows[0].queued,1);
    assert.deepEqual((await db.query("select recipient,payload->>'payment_url' payment_url,payload->>'yoco_checkout_id' yoco_checkout_id from notification_jobs where source_id=$1 and status='QUEUED'",[changedVoucherId])).rows[0],{
      recipient:'new@example.invalid',payment_url:'https://pay.example.invalid/new',yoco_checkout_id:'voucher-checkout-new',
    });
    await db.query("update vouchers set status='ACTIVE' where id=$1",[changedVoucherId]);

    const legacySentVoucherId=id(904031);
    await db.query("insert into vouchers(id,business_id,code,current_balance,value,status,buyer_email,payment_url,payment_reminder_sent_at,created_at) values($1,$2,'DURABLE4',100,100,'PENDING','legacy-sent@example.invalid','https://pay.example.invalid/legacy',now()-interval '1 day',now()-interval '20 minutes')",[legacySentVoucherId,businessId]);
    assert.equal((await db.query('select enqueue_voucher_payment_reminder($1) result',[legacySentVoucherId])).rows[0].result.status,'NOT_ELIGIBLE');
    await db.query('select enqueue_voucher_payment_reminders(10,2)');
    assert.equal((await db.query('select count(*)::int count from notification_jobs where source_id=$1',[legacySentVoucherId])).rows[0].count,0);

    const staleJobId=id(904016),staleClaim=id(904022),lastClaim=id(904023);
    await db.query(`insert into notification_jobs(id,business_id,booking_id,source_type,source_id,template_type,recipient,dedupe_key,status,attempts,max_attempts,first_attempt_at,claim_id,claimed_at)
      values($1,$2,$3,'HOLD_PAYMENT_REMINDER',$4,'PAYMENT_LINK','reminder@example.invalid',$5,'PROCESSING',5,5,now()-interval '10 minutes',$6,now()-interval '6 minutes')`,
      [staleJobId,businessId,id(904012),id(904017),'hold-payment-link/'+id(904017),staleClaim]);
    const lastRecovery=(await db.query('select * from claim_notification_jobs($1,10,5)',[lastClaim])).rows;
    assert.equal(lastRecovery.length,1);
    assert.equal(lastRecovery[0].attempts,6);
    assert.equal((await db.query('select validate_notification_job($1,$2) result',[staleJobId,lastClaim])).rows[0].result,'CANCELLED');
  });
  await check('manual notification retry independently authorizes and audits the actor',async()=>{
    const businessId=id(900101),jobId=id(904050);
    await db.query(`insert into notification_jobs(id,business_id,source_type,source_id,template_type,recipient,dedupe_key,status,attempts,max_attempts,first_attempt_at,last_error)
      values($1,$2,'TEST',$3,'PAYMENT_LINK','retry@example.invalid',$4,'FAILED',2,5,now()-interval '1 hour','provider unavailable')`,
      [jobId,businessId,id(904051),'retry-test/'+jobId]);
    assert.equal((await db.query('select retry_notification_job($1,$2,$3) result',[jobId,businessId,id(901001)])).rows[0].result.status,'FORBIDDEN');
    assert.equal((await db.query('select retry_notification_job($1,$2,$3) result',[jobId,businessId,id(901006)])).rows[0].result.status,'FORBIDDEN');
    const before=(await db.query('select attempts,first_attempt_at,dedupe_key from notification_jobs where id=$1',[jobId])).rows[0];
    assert.equal((await db.query('select retry_notification_job($1,$2,$3) result',[jobId,businessId,id(901003)])).rows[0].result.status,'QUEUED');
    const after=(await db.query('select status,attempts,first_attempt_at,dedupe_key from notification_jobs where id=$1',[jobId])).rows[0];
    assert.equal(after.status,'QUEUED'); assert.equal(after.attempts,before.attempts);
    assert.equal(after.first_attempt_at.toISOString(),before.first_attempt_at.toISOString()); assert.equal(after.dedupe_key,before.dedupe_key);
    assert.equal((await db.query("select count(*)::int count from audit_logs where action_type='NOTIFICATION_JOB_RETRY' and target_id=$1 and actor_id=$2",[jobId,id(901003)])).rows[0].count,1);

    const expiredJobId=id(904052);
    await db.query(`insert into notification_jobs(id,business_id,source_type,source_id,template_type,recipient,dedupe_key,status,attempts,max_attempts,first_attempt_at,last_error)
      values($1,$2,'TEST',$3,'PAYMENT_LINK','expired@example.invalid',$4,'FAILED',2,5,now()-interval '24 hours','known rejection')`,
      [expiredJobId,businessId,id(904053),'retry-test/'+expiredJobId]);
    assert.equal((await db.query('select retry_notification_job($1,$2,$3) result',[expiredJobId,businessId,id(901003)])).rows[0].result.status,'RETRY_WINDOW_EXPIRED');
    assert.equal((await db.query('select status from notification_jobs where id=$1',[expiredJobId])).rows[0].status,'FAILED');
  });
  await check('pricing migration preserves existing subscriptions, plans, and open billing lines', async()=>{
    const after=(await db.query(`
      select jsonb_build_object(
        'plan',(select to_jsonb(p) from plans p where id='standard'),
        'subscription',(select to_jsonb(s) from subscriptions s where business_id=$1),
        'lines',(select jsonb_agg(to_jsonb(li) order by li.kind,li.id) from billing_line_items li where business_id=$1)
      ) snapshot`,[existingPricingBusiness])).rows[0].snapshot;
    assert.deepEqual(after,existingPricingSnapshot);
  });
  await check('future subscriptions use the versioned R2000 cohort with free setup',async()=>{
    const result=(await db.query('select platform_complete_business_setup($1,null) result',[futurePricingBusiness])).rows[0].result;
    assert.equal(result.subscription_created,true);
    const sub=(await db.query('select plan_id,status from subscriptions where business_id=$1',[futurePricingBusiness])).rows[0];
    assert.deepEqual(sub,{plan_id:'standard-2026-09-21',status:'ACTIVE'});
    assert.deepEqual((await db.query('select kind,amount_zar::numeric::text amount,status from billing_line_items where business_id=$1 order by kind',[futurePricingBusiness])).rows,[
      {kind:'ONE_OFF',amount:'0.00',status:'PENDING'},
      {kind:'RECURRING',amount:'2000.00',status:'ACTIVE'},
    ]);
    await db.query(readFileSync('supabase/migrations/20260920090000_enforce_standard_plan_pricing.sql','utf8'));
    assert.equal((await db.query('select count(*)::int count from subscriptions where business_id=$1',[futurePricingBusiness])).rows[0].count,1);
  });
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("insert into businesses(id,name,operator_email,subscription_status) values ($1,'Operator A','a@example.invalid','ACTIVE'),($2,'Operator B','b@example.invalid','ACTIVE')", [id(1), id(2)]);
  await db.query(`insert into admin_users(id,user_id,business_id,email,password_hash,role,suspended) values
    ($1,$2,$3,'main-a@example.invalid','fixture','MAIN_ADMIN',false),
    ($4,$5,$6,'main-b@example.invalid','fixture','MAIN_ADMIN',false),
    ($7,$8,$3,'platform@example.invalid','fixture','SUPER_ADMIN',false),
    ($9,$10,$3,'suspended@example.invalid','fixture','SUPER_ADMIN',true)`,
  [id(11),id(101),id(1),id(12),id(102),id(2),id(13),id(103),id(14),id(104)]);
  await db.query(`insert into admin_users(id,user_id,business_id,email,password_hash,role,suspended,read_only) values
    ($1,$2,$3,'operator-a@example.invalid','fixture','OPERATOR',false,false),
    ($4,$5,$3,'legacy-a@example.invalid','fixture','ADMIN',false,false),
    ($6,$7,$3,'unknown-a@example.invalid','fixture','FUTURE_STAFF',false,false),
    ($8,$9,$3,'super-prefix@example.invalid','fixture','SUPER_PREFIX',false,false),
    ($10,$11,$3,'demo-platform@example.invalid','fixture','SUPER_ADMIN',false,true)`,
  [id(15),id(105),id(1),id(16),id(106),id(17),id(107),id(18),id(108),id(19),id(109)]);
  for (const user of [107,108]) {
    await check(`unknown staff ${user} has no tenant RLS authority`,()=>as('authenticated',user,{},async()=>{
      assert.deepEqual((await db.query('select current_business_ids() ids')).rows[0].ids,[]);
    }));
  }
  for (const user of [105,106,101]) {
    await check(`exact own-tenant staff ${user} keeps tenant RLS authority`,()=>as('authenticated',user,{},async()=>{
      assert.deepEqual((await db.query('select current_business_ids() ids')).rows[0].ids,[id(1)]);
    }));
  }
  for (const user of [103,109]) {
    await check(`exact platform staff ${user} retains browsing`,()=>as('authenticated',user,{},async()=>{
      const ids=(await db.query('select current_business_ids() ids')).rows[0].ids;
      assert(ids.includes(id(1)) && ids.includes(id(2)));
    }));
  }
  await check('suspended staff has no tenant RLS authority',()=>as('authenticated',104,{},async()=>{
    assert.deepEqual((await db.query('select current_business_ids() ids')).rows[0].ids,[]);
  }));
  await check('only exact active SUPER_ADMIN may update public platform settings',()=>as('authenticated',103,{},async()=>{
    assert.equal((await db.query("update platform_public_settings set value='{}'::jsonb where key='directory' returning key")).rowCount,1);
  }));
  for (const user of [107,108,104]) {
    await check(`staff ${user} cannot mutate public platform settings`,()=>as('authenticated',user,{},async()=>{
      assert.equal((await db.query("update platform_public_settings set value='{}'::jsonb where key='directory' returning key")).rowCount,0);
    }));
  }
  await check('read-only platform demo can browse settings but cannot mutate',()=>as('authenticated',109,{},async()=>{
    assert.equal((await db.query("select key from platform_public_settings where key='directory'")).rowCount,1);
    assert.equal((await db.query("update platform_public_settings set value='{\"blocked\":true}'::jsonb where key='directory' returning key")).rowCount,0);
  }));
  await check('demo date refresh has service-only EXECUTE, including explicit client grants',async()=>{
    for (const role of ['anon','authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,'public.refresh_claires_hiking_demo_dates(uuid,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
      await as(role,role==='authenticated'?101:null,{},async()=>{
        await assert.rejects(db.query('select refresh_claires_hiking_demo_dates($1)',[id(1)]),{code:'42501'});
      });
    }
    await as('service_role',null,{},async()=>{
      assert.equal((await db.query('select refresh_claires_hiking_demo_dates($1) result',[id(1)])).rows[0].result,null);
    });
  });

  // Shared partial-arrival contract: one conflict-checked absolute count, one
  // audit row, and compatibility for old boolean writers and booking moves.
  await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values ($1,$2,'Arrival tour',100,10),($3,$4,'Foreign arrival tour',100,10)", [id(701),id(1),id(702),id(2)]);
  await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total) values ($1,$2,$3,now()+interval '1 day',10),($4,$2,$3,now()+interval '2 days',10),($5,$6,$7,now()+interval '1 day',10)", [id(711),id(1),id(701),id(712),id(721),id(2),id(702)]);
  await db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status,waiver_status) values ($1,$2,$3,$4,'Arrival fixture','arrival@fixture.invalid',6,100,600,'PAID','SIGNED'),($5,$2,$3,$4,'Concurrent fixture','concurrent@fixture.invalid',6,100,600,'PAID','SIGNED')", [id(731),id(1),id(701),id(711),id(732)]);
  const arrivalSql = "select record_booking_arrival($1,$2,$3,$4,$5,$6,$7,$8,$9) result";
  const arrivalArgs = (booking, target, expected, event, business=id(1), slot=id(711)) => [booking,business,id(11),target,expected,event,'rollout-test',null,slot];
  const authenticatedArrivalSql = "select record_authenticated_booking_arrival($1,$2,$3,$4,$5,$6,$7,$8) result";
  const authenticatedArrivalArgs = (booking, target, expected, event, business=id(1), slot=id(711)) => [booking,business,target,expected,event,'rollout-test',null,slot];

  await check('partial arrivals progress 0 to 4 with an atomic audit row',()=>as('service_role',null,{},async()=>{
    const result=(await db.query(arrivalSql,arrivalArgs(id(731),4,0,'arrival-1'))).rows[0].result;
    assert.equal(result.ok,true); assert.equal(result.arrived_count,4); assert.equal(result.checked_in,false);
    assert.deepEqual((await db.query('select arrived_count_before,arrived_count_after from slot_check_ins where booking_id=$1',[id(731)])).rows,[{arrived_count_before:0,arrived_count_after:4}]);
  }));
  // The prior check rolls back, so persist the state for the remaining checks.
  await db.query(arrivalSql,arrivalArgs(id(731),4,0,'arrival-1'));
  await check('arrival event replay is idempotent even when the retried target differs',()=>as('service_role',null,{},async()=>{
    const result=(await db.query(arrivalSql,arrivalArgs(id(731),6,0,'arrival-1'))).rows[0].result;
    assert.equal(result.ok,true); assert.equal(result.replay,true); assert.equal(result.arrived_count,4);
    assert.equal((await db.query('select count(*)::int count from slot_check_ins where booking_id=$1',[id(731)])).rows[0].count,1);
  }));
  await check('stale arrival updates return canonical state without an audit event',()=>as('service_role',null,{},async()=>{
    const result=(await db.query(arrivalSql,arrivalArgs(id(731),6,0,'arrival-stale'))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'STALE'); assert.equal(result.arrived_count,4);
    assert.equal((await db.query("select count(*)::int count from slot_check_ins where client_event_id='arrival-stale'")).rows[0].count,0);
  }));
  await check('partial arrivals complete the group and derive the legacy flag',()=>as('service_role',null,{},async()=>{
    const result=(await db.query(arrivalSql,arrivalArgs(id(731),6,4,'arrival-2'))).rows[0].result;
    assert.equal(result.ok,true); assert.equal(result.arrived_count,6); assert.equal(result.checked_in,true); assert(result.checked_in_at);
  }));
  await db.query(arrivalSql,arrivalArgs(id(731),6,4,'arrival-2'));
  await check('quantity growth preserves arrivals while a reduction below arrivals is rejected',()=>as('service_role',null,{},async()=>{
    const grown=(await db.query('update bookings set qty=8 where id=$1 returning qty,arrived_count,checked_in,checked_in_at',[id(731)])).rows[0];
    assert.deepEqual(grown,{qty:8,arrived_count:6,checked_in:false,checked_in_at:null});
    await assert.rejects(db.query('update bookings set qty=5 where id=$1',[id(731)]),{code:'23514'});
  }));
  await check('legacy boolean writers still set and undo the whole current group',()=>as('service_role',null,{},async()=>{
    assert.deepEqual((await db.query('update bookings set checked_in=false where id=$1 returning arrived_count,checked_in',[id(731)])).rows[0],{arrived_count:0,checked_in:false});
    assert.deepEqual((await db.query('update bookings set checked_in=true where id=$1 returning arrived_count,checked_in',[id(731)])).rows[0],{arrived_count:6,checked_in:true});
  }));
  await check('moving a booking resets attendance for the new departure',()=>as('service_role',null,{},async()=>{
    const moved=(await db.query('update bookings set slot_id=$1 where id=$2 returning slot_id,arrived_count,checked_in,checked_in_at',[id(712),id(731)])).rows[0];
    assert.deepEqual(moved,{slot_id:id(712),arrived_count:0,checked_in:false,checked_in_at:null});
  }));
  await check('arrival RPC does not reveal or mutate a booking through a foreign tenant id',()=>as('service_role',null,{},async()=>{
    const result=(await db.query(arrivalSql,arrivalArgs(id(731),6,4,'arrival-foreign',id(2)))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'NOT_FOUND');
  }));
  for (const [role,user] of [['anon',null],['authenticated',101]]) {
    await check(`${role} cannot invoke the service-only arrival RPC`,()=>as(role,user,{},async()=>{
      await assert.rejects(db.query(arrivalSql,arrivalArgs(id(731),6,4,'arrival-forged')),{code:'42501'});
    }));
  }
  await check('authenticated arrival wrapper derives the owned actor and preserves the locked mutation',()=>as('authenticated',101,{},async()=>{
    const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-authenticated'))).rows[0].result;
    assert.equal(result.ok,true); assert.equal(result.arrived_count,4);
    assert.deepEqual((await db.query("select actor_admin_id,business_id from slot_check_ins where client_event_id='arrival-authenticated'")).rows,[{actor_admin_id:id(11),business_id:id(1)}]);
  }));
  await check('authenticated arrival wrapper rejects a forged tenant',()=>as('authenticated',101,{},async()=>{
    const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-auth-foreign',id(2),id(721)))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'UNAUTHORIZED');
  }));
  await check('suspended administrators cannot use the authenticated arrival wrapper',()=>as('authenticated',104,{},async()=>{
    const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-auth-suspended'))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'UNAUTHORIZED');
  }));
  await check('platform administrators retain explicitly targeted arrival support',()=>as('authenticated',103,{},async()=>{
    const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-auth-platform',id(2),id(721)))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'NOT_FOUND');
  }));
  for (const [user,actor] of [[105,15],[106,16]]) {
    await check(`exact legacy staff ${user} retains attributable own-tenant arrival`,()=>as('authenticated',user,{},async()=>{
      const event='arrival-exact-'+user;
      const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),5,6,event))).rows[0].result;
      assert.equal(result.ok,true);
      assert.equal((await db.query('select actor_admin_id from slot_check_ins where client_event_id=$1',[event])).rows[0].actor_admin_id,id(actor));
    }));
  }
  for (const user of [107,108]) {
    await check(`unknown staff ${user} cannot invoke the authenticated arrival wrapper`,()=>as('authenticated',user,{},async()=>{
      const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),5,6,'arrival-unknown-'+user))).rows[0].result;
      assert.equal(result.code,'UNAUTHORIZED');
    }));
  }
  for (const role of ['anon','service_role']) {
    await check(`${role} cannot invoke the authenticated arrival wrapper`,()=>as(role,null,{},async()=>{
      await assert.rejects(db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-auth-forged')),{code:'42501'});
    }));
  }
  await db.query('update admin_users set read_only=true where id=$1',[id(11)]);
  await check('read-only administrators cannot use the authenticated arrival wrapper',()=>as('authenticated',101,{},async()=>{
    const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-auth-read-only'))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'UNAUTHORIZED');
  }));
  await db.query('update admin_users set read_only=false where id=$1',[id(11)]);
  await db.query("update businesses set subscription_status='PAUSED' where id=$1",[id(1)]);
  await check('inactive subscriptions cannot use the authenticated arrival wrapper',()=>as('authenticated',101,{},async()=>{
    const result=(await db.query(authenticatedArrivalSql,authenticatedArrivalArgs(id(731),4,6,'arrival-auth-paused'))).rows[0].result;
    assert.equal(result.ok,false); assert.equal(result.code,'SUBSCRIPTION_REQUIRED');
  }));
  await db.query("update businesses set subscription_status='ACTIVE' where id=$1",[id(1)]);
  await check('authenticated clients cannot bypass conflict checks with a direct partial-count update',()=>as('authenticated',101,{},async()=>{
    await assert.rejects(db.query('update bookings set arrived_count=2 where id=$1',[id(731)]),{code:'42501'});
  }));
  await check('legacy authenticated whole-group toggles remain coherent and audited',()=>as('authenticated',101,{},async()=>{
    const row=(await db.query('update bookings set checked_in=false where id=$1 returning arrived_count,checked_in',[id(731)])).rows[0];
    assert.deepEqual(row,{arrived_count:0,checked_in:false});
    const audit=(await db.query("select source,arrived_count_before,arrived_count_after from slot_check_ins where booking_id=$1 and source='legacy-admin'",[id(731)])).rows;
    assert.deepEqual(audit,[{source:'legacy-admin',arrived_count_before:6,arrived_count_after:0}]);
  }));
  await check('authenticated clients cannot suppress compatibility audit with a custom setting',()=>as('authenticated',101,{},async()=>{
    await db.query("select set_config('bookingtours.arrival_rpc','1',true)");
    await db.query('update bookings set checked_in=false where id=$1',[id(731)]);
    assert.equal((await db.query("select count(*)::int count from slot_check_ins where booking_id=$1 and source='legacy-admin'",[id(731)])).rows[0].count,1);
  }));
  await check('authenticated booking inserts cannot initialize unaudited arrivals',()=>as('authenticated',101,{},async()=>{
    await assert.rejects(db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status,waiver_status,arrived_count) values($1,$2,$3,$4,'Forged arrival','forged-arrival@example.invalid',6,100,600,'PAID','SIGNED',2)",[id(734),id(1),id(701),id(711)]),{code:'42501'});
  }));
  await check('authenticated clients cannot forge arrival audit rows',()=>as('authenticated',101,{},async()=>{
    await assert.rejects(db.query("insert into slot_check_ins(business_id,booking_id,slot_id,source) values($1,$2,$3,'forged')",[id(1),id(731),id(711)]),{code:'42501'});
  }));
  await check('arrival migration removes legacy table and PUBLIC column grants',async()=>{
    await db.query('grant insert,update,delete,truncate on slot_check_ins to authenticated');
    await db.query('grant insert(business_id,booking_id,slot_id,actor_admin_id,source,client_event_id),update(notes) on slot_check_ins to public');
    await db.query(readFileSync('supabase/migrations/20260920100000_partial_booking_arrivals.sql','utf8'));
    for(const role of ['anon','authenticated']) {
      const privileges=(await db.query(`select
        has_table_privilege($1,'slot_check_ins','INSERT,UPDATE,DELETE,TRUNCATE') table_dml,
        has_column_privilege($1,'slot_check_ins','booking_id','INSERT') column_insert,
        has_column_privilege($1,'slot_check_ins','notes','UPDATE') column_update`,[role])).rows[0];
      assert.deepEqual(privileges,{table_dml:false,column_insert:false,column_update:false});
    }
  });
  await check('concurrent absolute arrival updates cannot silently overwrite each other',async()=>{
    const clients=[new pg.Client({...connection,database}),new pg.Client({...connection,database})];
    try {
      await Promise.all(clients.map(client=>client.connect().then(()=>client.query('set role service_role'))));
      const results=await Promise.all([
        clients[0].query(arrivalSql,arrivalArgs(id(732),4,0,'arrival-concurrent-a')),
        clients[1].query(arrivalSql,arrivalArgs(id(732),5,0,'arrival-concurrent-b')),
      ]);
      const payloads=results.map(result=>result.rows[0].result);
      assert.equal(payloads.filter(result=>result.ok).length,1);
      assert.equal(payloads.filter(result=>result.code==='STALE').length,1);
      assert.equal((await db.query('select count(*)::int count from slot_check_ins where booking_id=$1',[id(732)])).rows[0].count,1);
    } finally { await Promise.all(clients.map(client=>client.end())); }
  });
  await db.query("insert into reviews(id,business_id,booking_id,source,status,rating) values ($1,$2,$3,'NATIVE','APPROVED',5)", [id(31),id(2),id(71)]);

  for (const [user, foreign] of [[101,2],[102,1]]) {
    await check(`R04 authenticated operator ${user} cannot read foreign business with forged headers`, () => as('authenticated', user, {'x-tenant-business-id':id(foreign)}, async () => {
      assert.equal((await db.query('select * from businesses where id=$1', [id(foreign)])).rowCount, 0);
    }));
  }
  await check('R04 anonymous storefront still resolves public business fields', () => as('anon', null, {'x-tenant-business-id':id(2)}, async () => {
    assert.equal((await db.query('select id,name from businesses where id=$1', [id(2)])).rowCount, 1);
  }));
  await check('R04 anonymous storefront cannot select private fields', () => as('anon', null, {'x-tenant-business-id':id(2)}, async () => {
    await assert.rejects(db.query('select operator_email from businesses where id=$1', [id(2)]), {code:'42501'});
  }));
  await check('R01 public review display retains rating without private references', () => as('anon', null, {}, async () => {
    assert.equal((await db.query('select id,rating from reviews')).rowCount, 1);
  }));
  await check('R01 public reviews do not expose booking IDs', () => as('anon', null, {}, async () => {
    await assert.rejects(db.query('select booking_id from reviews'), {code:'42501'});
  }));
  await check('R04 signed-in users cannot use the public review policy for private references', () => as('authenticated', 101, {}, async () => {
    assert.equal((await db.query('select booking_id from reviews where business_id=$1',[id(2)])).rowCount, 0);
  }));
  await check('R10 suspended platform admins lose all tenant data access', () => as('authenticated', 104, {}, async () => {
    assert.equal((await db.query('select * from businesses')).rowCount, 0);
  }));
  await check('R10 ordinary operator settings remain editable', () => as('authenticated', 101, {}, async () => {
    assert.equal((await db.query("update businesses set name='New operator name' where id=$1",[id(1)])).rowCount, 1);
  }));
  await check('R10 operators cannot change platform billing fields', () => as('authenticated', 101, {}, async () => {
    await assert.rejects(db.query('update businesses set max_admin_seats=999 where id=$1',[id(1)]), {code:'42501'});
  }));
  await check('R10 platform administrators retain billing support', () => as('authenticated', 103, {}, async () => {
    assert.equal((await db.query('update businesses set max_admin_seats=3 where id=$1',[id(2)])).rowCount, 1);
  }));
  for (const role of ['anon', 'authenticated']) {
    await check(`${role} has no direct voucher reservation access`, () => as(role, role==='authenticated'?101:null, {}, async () => {
      await assert.rejects(db.query('select * from voucher_reservations'), {code:'42501'});
    }));
    await check(`R07 ${role} cannot call internal customer upsert`, () => as(role, role==='authenticated'?101:null, {}, async () => {
      await assert.rejects(db.query("select upsert_customer($1,'customer@example.invalid','Forged',null,true)",[id(2)]), {code:'42501'});
    }));
    await check(`R07 ${role} cannot alter another operator's metered usage`, () => as(role, role==='authenticated'?101:null, {}, async () => {
      await assert.rejects(db.query("select increment_marketing_monthly_usage($1,'2026-09',100)",[id(2)]), {code:'42501'});
    }));
  }
  await check('R07 service workers retain customer and usage bookkeeping', () => as('service_role', null, {}, async () => {
    assert((await db.query("select upsert_customer($1,'customer@example.invalid','Customer',null,true) as id",[id(1)])).rows[0].id);
    await db.query("select increment_marketing_monthly_usage($1,'2026-09',1)",[id(1)]);
  }));

  for (const { jobname, command } of (await db.query('select * from cron.job where jobid < 5 order by jobid')).rows) {
    await check('R08 scheduled ' + jobname + ' uses a server-only Vault credential', async () => {
      assert(!command.includes('local-fixture-server-only-not-a-real-key'));
      await db.query(command);
      const request = (await db.query('select * from net.fixture_requests')).rows.at(-1);
      assert.equal(request.headers.apikey, 'local-fixture-server-only-not-a-real-key');
      assert.equal(request.headers['Content-Type'], 'application/json');
      assert.equal(request.timeout_milliseconds, 60000);
      if (jobname === 'review-reminders-daily') assert.equal(request.body.action, 'review_reminders');
    });
  }
  await check('R08 scheduler migration leaves unrelated jobs unchanged', async () => {
    assert.deepEqual((await db.query('select schedule,command from cron.job where jobid=5')).rows[0], {schedule:'0 0 * * *',command:'select 42'});
  });
  await check('scheduler timeout correction is safe to reapply', async () => {
    const before = (await db.query('select * from cron.job order by jobid')).rows;
    await db.query(readFileSync('supabase/migrations/20260913070000_message_job_request_timeout.sql','utf8'));
    assert.deepEqual((await db.query('select * from cron.job order by jobid')).rows,before);
  });
  await check('R08 scheduler migration refuses missing credentials without altering jobs', async () => {
    const before = (await db.query('select * from cron.job order by jobid')).rows;
    await db.query('begin');
    try {
      await db.query('delete from vault.decrypted_secrets');
      const migration = readFileSync('supabase/migrations/20260908081000_authenticate_message_crons.sql','utf8').replace(/^(begin|commit);/gm,'');
      await assert.rejects(db.query(migration), /Vault secret is required/);
    } finally { await db.query('rollback'); }
    assert.deepEqual((await db.query('select * from cron.job order by jobid')).rows,before);
  });

  // More ineligible rows than either worker's batch limit, ahead of active work.
  await db.query("insert into businesses(id,name,operator_email,subscription_status) values ($1,'Paused operator','paused@fixture.invalid','PAUSED')",[id(3)]);
  for (const n of [1,2,3]) {
    await db.query("insert into marketing_templates(id,business_id,name) values ($1,$2,'Template')",[id(200+n),id(n)]);
    await db.query("insert into marketing_campaigns(id,business_id,template_id,name,status) values ($1,$2,$3,'Campaign','sending')",[id(210+n),id(n),id(200+n)]);
    await db.query("insert into marketing_contacts(id,business_id,email) values ($1,$2,$3)",[id(300+n),id(n),`guest-${n}@fixture.invalid`]);
    await db.query("insert into marketing_automations(id,business_id,name,trigger_type,status) values ($1,$2,'Automation','manual','active')",[id(400+n),id(n)]);
  }
  for (const n of [1,2]) {
    await db.query("insert into marketing_queue(id,business_id,campaign_id,contact_id,email,created_at) values ($1,$2,$3,$4,'guest@fixture.invalid',now()-interval '1 hour')",[id(500+n),id(n),id(210+n),id(300+n)]);
    await db.query("insert into marketing_automation_enrollments(id,business_id,automation_id,contact_id,next_action_at) values ($1,$2,$3,$4,now()-interval '1 hour')",[id(600+n),id(n),id(400+n),id(300+n)]);
  }
  await db.query(`insert into marketing_contacts(id,business_id,email)
    select md5('contact-'||n)::uuid,$1,'paused-'||n||'@fixture.invalid' from generate_series(1,600) n`,[id(3)]);
  await db.query(`insert into marketing_queue(business_id,campaign_id,contact_id,email,created_at)
    select $1,$2,id,email,now()-interval '2 days' from marketing_contacts where business_id=$1`,[id(3),id(213)]);
  await db.query(`insert into marketing_automation_enrollments(business_id,automation_id,contact_id,next_action_at)
    select $1,$2,id,now()-interval '2 days' from marketing_contacts where business_id=$1`,[id(3),id(403)]);
  await db.query("insert into marketing_campaigns(id,business_id,template_id,name,status) values ($1,$2,$3,'Paused campaign','paused'),($4,$2,$3,'Scheduled campaign','scheduled')",[id(214),id(1),id(201),id(215)]);
  await db.query("insert into marketing_queue(business_id,campaign_id,contact_id,email,created_at) values ($1,$2,$3,'paused-campaign@fixture.invalid',now()-interval '3 days'),($1,$4,$3,'scheduled-campaign@fixture.invalid',now()-interval '3 days')",[id(1),id(214),id(301),id(215)]);
  await db.query("insert into marketing_automations(id,business_id,name,trigger_type,status) values ($1,$2,'Paused automation','manual','paused')",[id(404),id(1)]);
  await db.query("insert into marketing_automation_enrollments(business_id,automation_id,contact_id,next_action_at) values ($1,$2,$3,now()-interval '3 days')",[id(1),id(404),id(301)]);

  const claims = [
    ['claim_marketing_queue','select * from claim_marketing_queue(1,3,$1)',[id(501),id(502)]],
    ['claim_marketing_automation_enrollments','select * from claim_marketing_automation_enrollments(1,$1)',[id(601),id(602)]],
  ];
  for (const [name,sql,expected] of claims) {
    await check(`R17 ${name} skips a backlog of paused work before limiting`, () => as('service_role',null,{},async () => {
      assert.deepEqual((await db.query(sql,[null])).rows.map(row=>row.id),[expected[0]]);
    }));
    await check(`R08 ${name} respects an operator-scoped invocation`, () => as('service_role',null,{},async () => {
      const result = (await db.query(sql,[id(2)])).rows;
      assert.deepEqual(result.map(row=>row.business_id),[id(2)]);
    }));
    for (const role of ['anon','authenticated']) {
      await check(`R08 ${role} cannot invoke service claim ${name}`,()=>as(role,role==='authenticated'?101:null,{},async()=>{
        await assert.rejects(db.query(sql,[null]),{code:'42501'});
      }));
    }
    await check(`R17 concurrent ${name} claims cannot take the same rows`,async()=>{
      const clients = [new pg.Client({...connection,database}),new pg.Client({...connection,database})];
      try {
        await Promise.all(clients.map(async client=>{
          await client.connect(); await client.query("begin; set local role service_role; set local statement_timeout='3s'");
        }));
        const results = await Promise.all(clients.map(client=>client.query(sql,[null])));
        const ids = results.flatMap(result=>result.rows.map(row=>row.id));
        assert.equal(new Set(ids).size,2);
        assert.deepEqual(ids.sort(),expected);
      } finally { await Promise.all(clients.map(async client=>{await client.query('rollback'); await client.end();})); }
    });
  }

  for (const [table,col,foreign,target] of [
    ['marketing_campaigns','template_id',202,211],
    ['marketing_queue','campaign_id',212,501], ['marketing_queue','contact_id',302,501],
    ['marketing_automation_enrollments','automation_id',402,601], ['marketing_automation_enrollments','contact_id',302,601],
  ]) {
    for (const role of ['authenticated','service_role']) {
      await check(`R09 ${role} cannot mix foreign ${table}.${col}`,()=>as(role,role==='authenticated'?101:null,{},async()=>{
        await assert.rejects(db.query(`update ${table} set ${col}=$1 where business_id=$2 and id=$3`,[id(foreign),id(1),id(target)]),{code:'23503'});
      }));
    }
  }
  const relationInserts = [
    ["insert into marketing_automation_logs(business_id,automation_id,contact_id,enrollment_id,action) values ($1,$2,$3,$4,'email_sent')",[1,401,301,601],[1,2,3],[402,302,602]],
    ["insert into marketing_unsubscribe_tokens(business_id,campaign_id,contact_id,token) values ($1,$2,$3,'fixture')",[1,211,301],[1,2],[212,302]],
    ["insert into marketing_events(business_id,campaign_id,contact_id,queue_id,event_type) values ($1,$2,$3,$4,'open')",[1,211,301,501],[1,2,3],[212,302,502]],
  ];
  for (const [sql,values,positions,foreigns] of relationInserts) {
    await check('R09 consistent worker relationships remain writable: '+sql.split('(')[0],()=>as('service_role',null,{},async()=>{
      assert.equal((await db.query(sql,values.map(id))).rowCount,1);
    }));
    for (let n=0;n<positions.length;n++) {
      await check('R09 worker write rejects foreign relation '+foreigns[n]+': '+sql.split('(')[0],()=>as('service_role',null,{},async()=>{
        const args=values.map(id); args[positions[n]]=id(foreigns[n]);
        await assert.rejects(db.query(sql,args),{code:'23503'});
      }));
    }
  }
  await check('R09 the automation editor can still save drafts and same-tenant templates',()=>as('authenticated',101,{},async()=>{
    for (const config of [{template_id:''},{template_id:id(201)}]) {
      const result=await db.query("insert into marketing_automation_steps(automation_id,position,step_type,config) values ($1,0,'send_email',$2) returning business_id,template_id",[id(401),config]);
      assert.equal(result.rows[0].business_id,id(1));
      assert.equal(result.rows[0].template_id,config.template_id || null);
    }
  }));
  await check('R09 a JSON template reference cannot select another operator',()=>as('authenticated',101,{},async()=>{
    await assert.rejects(db.query("insert into marketing_automation_steps(automation_id,position,step_type,config) values ($1,0,'send_email',$2)",[id(401),{template_id:id(202)}]),{code:'23503'});
  }));
  await check('R09 moving a referenced template to another business is rejected',()=>as('service_role',null,{},async()=>{
    await assert.rejects(db.query('update marketing_templates set business_id=$1 where id=$2',[id(2),id(201)]),{code:'23503'});
  }));
  await check('R09 template deletion still works without nulling tenant IDs or losing other step settings',()=>as('authenticated',101,{},async()=>{
    await db.query("insert into marketing_automation_steps(automation_id,position,step_type,config) values ($1,0,'send_email',$2)",[id(401),{template_id:id(201),subject_override:'Keep me'}]);
    await db.query('delete from marketing_templates where id=$1',[id(201)]);
    const campaign=(await db.query('select business_id,template_id from marketing_campaigns where id=$1',[id(211)])).rows[0];
    assert.deepEqual(campaign,{business_id:id(1),template_id:null});
    const step=(await db.query('select business_id,template_id,config from marketing_automation_steps where automation_id=$1',[id(401)])).rows[0];
    assert.deepEqual(step,{business_id:id(1),template_id:null,config:{subject_override:'Keep me'}});
  }));
  await check('R09 replacing FKs preserves unambiguous PostgREST relationships',async()=>{
    const result=await db.query("select conname,array_length(conkey,1) as columns from pg_constraint where conrelid='marketing_campaigns'::regclass and confrelid='marketing_templates'::regclass");
    assert.deepEqual(result.rows,[{conname:'marketing_campaigns_template_id_fkey',columns:2}]);
  });

  for (const n of [1,2]) {
    await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values ($1,$2,'Fixture tour',100,10)",[id(800+n),id(n)]);
    await db.query(`insert into slots(id,business_id,tour_id,start_time,capacity_total)
      select md5('slot-'||$1::uuid::text||'-'||n)::uuid,$1::uuid,$2::uuid,'2026-09-10'::timestamptz+n*interval '1 minute',10
      from generate_series(1,1201) n`,[id(n),id(800+n)]);
    await db.query(`insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,created_at)
      select md5('booking-'||s.id)::uuid,s.business_id,s.tour_id,s.id,'Fixture guest','guest@fixture.invalid',1,100,100,
        '2026-09-01'::timestamptz from slots s where s.business_id=$1`,[id(n)]);
  }
  // Interleave unslotted rows in the same ordering; include one outside the
  // period and one inactive row that should retain the previous exclusion.
  for (const [n,status,date] of [[901,'PAID','2026-09-01'],[902,'PENDING','2026-09-01'],[903,'CANCELLED','2026-09-01'],[904,'PAID','2026-08-01']]) {
    await db.query("insert into bookings(id,business_id,tour_id,customer_name,email,qty,unit_price,total_amount,status,created_at) values ($1,$2,$3,'Unslotted guest','guest@fixture.invalid',1,100,100,$4,$5)",[id(n),id(1),id(801),status,date]);
  }
  const dashboardBooking=(await db.query(`select b.id from bookings b join slots s on s.id=b.slot_id
    where b.business_id=$1 and s.start_time>='2026-09-10T00:00:00+02:00' and s.start_time<'2026-09-11T00:00:00+02:00'
    order by b.id limit 1`,[id(1)])).rows[0].id;
  const dashboardSlots=(await db.query('select id from slots where business_id=$1 order by start_time limit 2',[id(1)])).rows.map(row=>row.id);
  await db.query("update bookings set status='PAID',refund_status='REQUESTED',refund_amount=25,total_amount=100,created_at='2026-09-10T08:00:00+02:00' where id=$1",[dashboardBooking]);
  await db.query('update slots set booked=1 where id=any($1::uuid[])',[dashboardSlots]);
  await db.query("insert into add_ons(id,business_id,name,price) values($1,$2,'Snapshot extra',10)",[id(950),id(1)]);
  await db.query('insert into booking_add_ons(booking_id,add_on_id,qty,unit_price) values($1,$2,2,10)',[dashboardBooking,id(950)]);
  await db.query("insert into conversations(id,business_id,phone,status) values($1,$2,'fixture-1','HUMAN'),($3,$4,'fixture-2','HUMAN')",[id(951),id(1),id(952),id(2)]);
  await db.query("insert into trip_photos(id,business_id,slot_id,uploaded_at) values($1,$2,$3,'2026-09-10T09:00:00+02:00')",[id(953),id(1),dashboardSlots[0]]);
  const dashboardSql=`select get_operator_dashboard(
    $1,'2026-09-10T00:00:00+02:00','2026-09-11T00:00:00+02:00','2026-09-12T00:00:00+02:00',
    '2026-09-03T12:00:00+02:00','2026-09-01T00:00:00+02:00','2026-09-10T12:00:00+02:00'
  ) snapshot`;
  await check('dashboard snapshot preserves the complete owned view in one request',()=>as('authenticated',101,{},async()=>{
    const snapshot=(await db.query(dashboardSql,[id(1)])).rows[0].snapshot;
    assert.equal(snapshot.business_id,id(1));
    assert(snapshot.today_manifest.length>=1201);
    assert(snapshot.today_manifest.every(row=>row.business_id===id(1)));
    assert.equal(snapshot.tomorrow_manifest.length,0);
    assert.equal(snapshot.refund_count,1);
    assert.equal(Number(snapshot.refund_total),25);
    assert.equal(snapshot.inbox_count,1);
    assert.equal(snapshot.photos_outstanding,1);
    assert.equal(Number(snapshot.revenue.today),100);
    assert.equal(Number(snapshot.revenue.week),100);
    assert.equal(Number(snapshot.revenue.month),200);
    assert.equal(snapshot.revenue.series.length,10);
    assert.equal(snapshot.revenue.series.reduce((sum,value)=>sum+Number(value),0),200);
    const booking=snapshot.today_manifest.find(row=>row.id===dashboardBooking);
    assert.deepEqual(booking.add_ons,[{name:'Snapshot extra',qty:2}]);
  }));
  for (const [user,foreign] of [[101,2],[102,1],[104,1],[999,1]]) {
    await check(`dashboard snapshot cannot widen caller ${user} using forged tenant headers`,()=>as('authenticated',user,{'x-tenant-business-id':id(foreign)},async()=>{
      assert.equal((await db.query(dashboardSql,[id(foreign)])).rows[0].snapshot,null);
    }));
  }
  await check('anonymous callers cannot use the dashboard snapshot',()=>as('anon',null,{'x-tenant-business-id':id(1)},async()=>{
    await assert.rejects(db.query(dashboardSql,[id(1)]),{code:'42501'});
  }));
  await check('service workers retain an explicitly scoped dashboard snapshot',()=>as('service_role',null,{},async()=>{
    const snapshot=(await db.query(dashboardSql,[id(2)])).rows[0].snapshot;
    assert.equal(snapshot.business_id,id(2));
    assert(snapshot.today_manifest.every(row=>row.business_id===id(2)));
  }));
  for (const user of [107,108]) {
    await check(`unknown staff ${user} cannot read direct or dashboard booking data`,()=>as('authenticated',user,{},async()=>{
      assert.equal((await db.query('select id from bookings where id=$1',[dashboardBooking])).rowCount,0);
      assert.equal((await db.query(dashboardSql,[id(1)])).rows[0].snapshot,null);
    }));
  }
  const listBookings = 'select id,business_id from list_operator_bookings($1,\'2026-09-01\',\'2026-09-30\',$2,$3)';
  await check('R18 one global booking offset covers 1201 slots and interleaved unslotted bookings exactly once',()=>as('authenticated',101,{},async()=>{
    const expected=(await db.query("select id from bookings where business_id=$1 and id<>all($2::uuid[]) order by created_at,id",[id(1),[id(903),id(904)]])).rows.map(row=>row.id);
    const actual=[];
    for(let offset=0;;offset+=50) {
      const rows=(await db.query(listBookings,[id(1),51,offset])).rows;
      assert(rows.every(row=>row.business_id===id(1)));
      actual.push(...rows.slice(0,50).map(row=>row.id));
      if(rows.length<=50) break;
    }
    // Other focused fixtures may add eligible rows; the pagination contract is
    // equality with the canonical query, not a brittle global row count.
    assert(expected.length>=1203);
    assert.deepEqual(actual,expected);
    assert.equal(new Set(actual).size,actual.length);
    assert(actual.includes(id(901)) && actual.includes(id(902)));
  }));
  for (const [user,foreign] of [[101,2],[102,1],[104,1],[999,1]]) {
    await check(`R18 booking RPC cannot widen caller ${user} using forged tenant/success headers`,()=>as('authenticated',user,{'x-tenant-business-id':id(foreign),'x-booking-success-token':id(901)},async()=>{
      assert.equal((await db.query(listBookings,[id(foreign),50,0])).rowCount,0);
    }));
  }
  await check('R18 anonymous callers cannot use the operator booking RPC',()=>as('anon',null,{'x-tenant-business-id':id(1)},async()=>{
    await assert.rejects(db.query(listBookings,[id(1),50,0]),{code:'42501'});
  }));
  for(const [role,user] of [['authenticated',103],['service_role',null]]) {
    await check(`R18 ${role} permitted support queries retain scope and a bounded page size`,()=>as(role,user,{},async()=>{
      const rows=(await db.query(listBookings,[id(2),2000,0])).rows;
      assert.equal(rows.length,1000);
      assert(rows.every(row=>row.business_id===id(2)));
      assert.equal((await db.query(listBookings,[id(2),50,5000])).rowCount,0);
    }));
  }
  for (const user of [107,108]) {
    await check(`unknown staff ${user} cannot page operator bookings`,()=>as('authenticated',user,{},async()=>{
      assert.equal((await db.query(listBookings,[id(1),50,0])).rowCount,0);
    }));
  }
  for (const method of ['GET','POST','PATCH']) {
    for (const [role,user] of [['anon',null],['authenticated',102],['authenticated',104],['authenticated',999]]) {
      await check(`R01 ${role}/${user} cannot read a paid booking using its ID as a success token (${method})`,()=>as(role,user,{'x-tenant-business-id':id(1),'x-booking-success-token':id(901)},async()=>{
        await db.query("select set_config('request.method',$1,true)",[method]);
        assert.equal((await db.query('select * from bookings where id=$1',[id(901)])).rowCount,0);
      }));
    }
  }
  await check('R01 a signed confirmation capability cannot be replayed as a database header',()=>as('anon',null,{'x-tenant-business-id':id(1),'x-booking-success-token':'not-a-database-credential'},async()=>{
    assert.equal((await db.query('select * from bookings where id=$1',[id(901)])).rowCount,0);
  }));
  const waiver=(await db.query('select waiver_token from bookings where id=$1',[id(901)])).rows[0].waiver_token;
  for (const [label,token,expected] of [['valid',waiver,1],['wrong',id(901),0]]) {
    await check(`R01 ${label} independent waiver token retains its existing boundary`,()=>as('anon',null,{'x-booking-id':id(901),'x-booking-waiver-token':token},async()=>{
      assert.equal((await db.query('select * from bookings where id=$1',[id(901)])).rowCount,expected);
      assert.equal((await db.query('select * from bookings where id=$1',[id(904)])).rowCount,0);
    }));
  }
  for (const [role,user] of [['authenticated',101],['authenticated',103],['service_role',null]]) {
    await check(`R01 authorized ${role}/${user} retains booking access without success headers`,()=>as(role,user,{},async()=>{
      assert.equal((await db.query('select * from bookings where id=$1',[id(901)])).rowCount,1);
    }));
  }
  await db.query("insert into customers(id,business_id,user_id,name,email) values ($1,$2,$3,'Verified guest','verified@fixture.invalid')",[id(971),id(1),id(191)]);
  await db.query('update bookings set customer_id=$1 where id=$2',[id(971),id(901)]);
  await check('R01 verified customer auth still reads only its own booking',()=>as('authenticated',191,{},async()=>{
    assert.equal((await db.query('select * from bookings where id=$1',[id(901)])).rowCount,1);
    assert.equal((await db.query('select * from bookings where id=$1',[id(904)])).rowCount,0);
  }));
  await checkPaymentFlows({db,connection,database,check,id});
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  for (const n of [1, 2]) {
    await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values($1,$2,'Boundary test',100,10)", [id(880000+n),id(n)]);
    await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total) values($1,$2,$3,now()+interval '10 days',10)", [id(880010+n),id(n),id(880000+n)]);
    await db.query("insert into customers(id,business_id,user_id,email) values($1,$2,$3,'boundary@fixture.invalid')", [id(880020+n),id(n),id(880090+n)]);
    await db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_id,customer_name,email,qty,unit_price,total_amount,status) values($1,$2,$3,$4,$5,'Boundary','boundary@fixture.invalid',1,100,100,'PENDING')", [id(880030+n),id(n),id(880000+n),id(880010+n),id(880020+n)]);
    await db.query("insert into vouchers(id,business_id,code,current_balance,value) values($1,$2,$3,100,100)", [id(880040+n),id(n),'BOUND00'+n]);
  }
  for (const [user,own,foreign] of [[101,1,2],[102,2,1]]) {
    await check(`client ${own} cannot insert trusted pricing through another client's public policy`,()=>as('authenticated',user,{'x-tenant-business-id':id(foreign)},async()=>{
      await assert.rejects(db.query("insert into bookings(business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,discount_percent,status) values($1,$2,$3,'Forged','forged@fixture.invalid',1,100,0,100,'PENDING')",[id(foreign),id(880000+foreign),id(880010+foreign)]),{code:'42501'});
    }));
    for (const [label,query,args] of [
      ['voucher debit', 'select deduct_voucher_balance($1,10)', [id(880040+foreign)]],
      ['capacity reservation', "select create_hold_with_capacity_check($1,$2,1,now()+interval '15 minutes')", [id(880030+foreign),id(880010+foreign)]],
      ['refund details', 'select calculate_booking_refund($1)', [id(880030+foreign)]],
    ]) {
      await check(`client ${own} cannot access client ${foreign} ${label} through a privileged RPC`,()=>as('authenticated',user,{'x-tenant-business-id':id(foreign)},async()=>{
        await assert.rejects(db.query(query,args),{code:'42501'});
      }));
    }
    await check(`client ${own} retains its own voucher debit`,()=>as('authenticated',user,{},async()=>{
      assert.equal((await db.query('select deduct_voucher_balance($1,10) result',[id(880040+own)])).rows[0].result.deducted,10);
    }));
    await check(`client ${own} retains its own capacity reservation`,()=>as('authenticated',user,{},async()=>{
      assert.equal((await db.query("select create_hold_with_capacity_check($1,$2,1,now()+interval '15 minutes') result",[id(880030+own),id(880010+own)])).rows[0].result.success,true);
    }));
    for (const [column,foreignId] of [['tour_id',880000+foreign],['slot_id',880010+foreign],['customer_id',880020+foreign]]) {
      await check(`client ${own} cannot attach another client's ${column} to its booking`,()=>as('authenticated',user,{},async()=>{
        await assert.rejects(db.query(`update bookings set ${column}=$1 where id=$2`,[id(foreignId),id(880030+own)]),{code:'23503'});
      }));
    }
    await check(`verified customer ${own} retains only its own refund preview`,()=>as('authenticated',880090+own,{},async()=>{
      assert.equal(typeof (await db.query('select calculate_booking_refund($1) result',[id(880030+own)])).rows[0].result.amount,'number');
      await assert.rejects(db.query('select calculate_booking_refund($1)',[id(880030+foreign)]),{code:'42501'});
    }));
  }
  for (const role of ['anon','authenticated']) {
    await check(`${role} POST cannot enumerate existing pending booking proofs using a tenant header`,()=>as(role,role==='authenticated'?101:null,{'x-tenant-business-id':id(2)},async()=>{
      await db.query("select set_config('request.method','POST',true)");
      assert.equal((await db.query('select id,waiver_token from bookings where business_id=$1',[id(2)])).rowCount,0);
    }));
  }
  await check('anonymous insert still returns its new booking proof without exposing older bookings',()=>as('anon',null,{'x-tenant-business-id':id(2),'x-booking-id':id(880051),'x-booking-waiver-token':id(880052)},async()=>{
    await db.query("select set_config('request.method','POST',true)");
    const inserted = await db.query("insert into bookings(id,waiver_token,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status) values($1,$2,$3,$4,$5,'New guest','new@fixture.invalid',1,100,100,'PENDING') returning id,waiver_token",[id(880051),id(880052),id(2),id(880002),id(880012)]);
    assert.equal(inserted.rowCount,1); assert(inserted.rows[0].waiver_token);
    assert.equal((await db.query('select id from bookings where business_id=$1',[id(2)])).rowCount,1);
  }));
  await check('even a service worker cannot attach a hold to another client slot',()=>as('service_role',null,{},async()=>{
    await assert.rejects(db.query("insert into holds(booking_id,slot_id,qty,expires_at) values($1,$2,1,now()+interval '15 minutes')",[id(880031),id(880012)]),{code:'23503'});
  }));
  await check('customer deletion clears its booking link without clearing the business',()=>as('service_role',null,{},async()=>{
    await db.query('delete from customers where id=$1',[id(880021)]);
    assert.deepEqual((await db.query('select customer_id,business_id from bookings where id=$1',[id(880031)])).rows[0],{customer_id:null,business_id:id(1)});
  }));
  await check('platform onboarding, seats, suspension, readiness and invoice lifecycle', async () => {
    // The scenario temporarily changes an invoice DEFAULT, so run as the
    // disposable schema owner, with service claims, and roll everything back.
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
      await db.query(readFileSync('tests/tenant-isolation/platform-admin.sql', 'utf8'));
    } finally { await db.query('rollback'); }
  });
  console.log(`Database regression checks passed: ${passed}`);
} finally {
  if (connected) await db.end();
  // Only the random database created by this process, on the validated local
  // server, is removed. No app database, records, or environment files involved.
  try { await admin.query('drop database if exists ' + database); } finally { await admin.end(); }
}
