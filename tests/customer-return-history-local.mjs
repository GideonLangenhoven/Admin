import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Disposable local PostgreSQL only; never loads application credentials.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), database: 'postgres', user: process.env.USER });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sql = path => readFileSync('supabase/migrations/' + path,'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE FUNCTION current_business_ids() RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[nullif(current_setting('fixture.business_id',true),'')::uuid] $$;
    CREATE TABLE businesses(id uuid PRIMARY KEY, subscription_status text);
    CREATE TABLE slots(id uuid PRIMARY KEY,business_id uuid,start_time timestamptz);
    CREATE TABLE bookings(id uuid PRIMARY KEY,business_id uuid,customer_name text,phone text,email text,created_at timestamptz,status text,slot_id uuid);
    CREATE TABLE policies(business_id uuid PRIMARY KEY,loyalty_bookings_threshold integer DEFAULT 2,loyalty_period_days integer DEFAULT 30,loyalty_discount_percent integer DEFAULT 10,group_discount_min_qty integer DEFAULT 6,group_discount_percent integer DEFAULT 5);
    CREATE TABLE marketing_contacts(id uuid PRIMARY KEY,business_id uuid,email text,phone text,status text);
    CREATE TABLE marketing_automations(id uuid PRIMARY KEY,business_id uuid,name text,trigger_type text,trigger_config jsonb,status text,enrolled_count integer DEFAULT 0,
      CONSTRAINT marketing_automations_trigger_type_check CHECK(trigger_type IN ('contact_added','tag_added','post_booking','date_field','manual')));
    CREATE TABLE marketing_automation_enrollments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,automation_id uuid,contact_id uuid,status text,current_step integer,
      next_action_at timestamptz,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(automation_id,contact_id));
    SELECT set_config('request.jwt.claim.role','service_role',true);`);
  await db.query(sql('20261015140000_customer_return_history.sql'));
  await db.query(sql('20261015150000_welcome_back_email_sequences.sql'));
  await db.query("INSERT INTO businesses VALUES($1,'ACTIVE'),($2,'ACTIVE')",[id(1),id(2)]);
  await db.query('INSERT INTO policies(business_id) VALUES($1)',[id(1)]);
  const booking = (n, days, status='PAID', business=id(1), email='guest@example.invalid', phone='082 555 0101') => db.query(
    `INSERT INTO bookings(id,business_id,created_at,status,email,phone) VALUES($1,$2,now()-make_interval(days=>$3),$4,$5,$6)`,[id(n),business,days,status,email,phone]);
  await booking(10,40); await booking(11,10); await booking(12,1,'PENDING');
  await booking(13,2,'CANCELLED'); await booking(14,3,'PENDING PAYMENT');
  await booking(15,1,'PAID',id(2));
  const history = async (business=id(1),phone='+27825550101',email=null) => (await db.query('SELECT customer_booking_history($1,$2,$3) h',[business,phone,email])).rows[0].h;
  assert.equal((await history()).booking_count,2);
  assert.equal((await history(id(1),null,' GUEST@EXAMPLE.INVALID ')).booking_count,2);
  assert.equal((await history(id(2))).booking_count,1);
  const previous = (await db.query('SELECT * FROM operator_booking_history($1,ARRAY[$2,$3]::uuid[])',[id(1),id(11),id(12)])).rows;
  assert.equal(previous.find(r=>r.booking_id===id(11)).previous_booking_count,1,'a paid row excludes itself and later bookings');
  assert.equal(previous.find(r=>r.booking_id===id(12)).previous_booking_count,2);
  await db.query("SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('fixture.business_id',$1,true)",[id(1)]);
  assert.equal((await db.query('SELECT * FROM operator_booking_history($1,ARRAY[$2]::uuid[])',[id(1),id(15)])).rows.length,0);
  await db.query('SAVEPOINT denied');
  await assert.rejects(db.query('SELECT * FROM operator_booking_history($1,ARRAY[$2]::uuid[])',[id(2),id(15)]),e=>e.code==='42501');
  await db.query('ROLLBACK TO SAVEPOINT denied');
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
  const discount = async qty => (await db.query('SELECT resolve_booking_discount($1,$2,$3) d',[id(1),'27825550101',qty])).rows[0].d;
  assert.equal((await discount(2)).percent,0,'legacy loyalty now respects the saved 30-day window');
  assert.equal((await discount(6)).percent,5);
  const rules = [
    {name:'Frequent guest',kind:'frequency',enabled:true,percent:10,min_guests:1,max_guests:null,min_bookings:2,window_days:90},
    {name:'Welcome back',kind:'recency',enabled:true,percent:15,min_guests:1,max_guests:5,min_days:10,max_days:60},
    {name:'Big group',kind:'group',enabled:true,percent:20,min_guests:8,max_guests:12},
  ];
  const save = value => db.query('UPDATE policies SET booking_discount_rules=$1::jsonb WHERE business_id=$2',[JSON.stringify(value),id(1)]);
  await save(rules);
  assert.equal((await discount(2)).percent,15,'highest matching offer wins without stacking');
  assert.equal((await discount(6)).percent,10,'recency group maximum is enforced');
  assert.equal((await discount(8)).percent,20);
  assert.equal((await discount(13)).percent,10);
  await save(rules.map(r=>({...r,enabled:false}))); assert.equal((await discount(8)).percent,0);
  await save([{...rules[0],percent:0}]); assert.equal((await discount(2)).percent,0);
  for (const invalid of [{...rules[0],percent:12.5},{...rules[0],percent:101},{...rules[0],min_bookings:0},{...rules[0],window_days:1.5},{...rules[1],max_days:1},{...rules[2],max_guests:''},{...rules[2],max_guests:1}]) {
    await db.query('SAVEPOINT invalid_rule');
    await assert.rejects(save([invalid]),e=>e.code==='23514');
    await db.query('ROLLBACK TO SAVEPOINT invalid_rule');
  }
  await save([]); assert.equal((await discount(8)).percent,0);
  // A new uncompleted reservation suppresses welcome-back marketing.
  await db.query("INSERT INTO marketing_contacts VALUES($1,$2,'guest@example.invalid','+27825550101','active')",[id(20),id(1)]);
  await db.query("INSERT INTO marketing_automations(id,business_id,name,trigger_type,trigger_config,status) VALUES($1,$2,'Welcome','booking_inactive','{\"days_since_last_booking\":5}','active')",[id(21),id(1)]);
  const enroll = async () => (await db.query('SELECT enroll_welcome_back_sequences($1) n',[id(1)])).rows[0].n;
  assert.equal(await enroll(),0);
  await db.query("UPDATE bookings SET status='CANCELLED' WHERE id IN ($1,$2)",[id(12),id(14)]);
  assert.equal(await enroll(),1);
  assert.equal(await enroll(),0,'a cron replay cannot double-enroll');
  let enrollment = (await db.query('SELECT * FROM marketing_automation_enrollments')).rows[0];
  const valid = async () => (await db.query('SELECT validate_welcome_back_enrollment($1,$2) ok',[enrollment.id,id(1)])).rows[0].ok;
  assert.equal(await valid(),true);
  await db.query("UPDATE marketing_automation_enrollments SET status='completed'");
  assert.equal(await enroll(),0,'completed sequences do not restart for the same last booking');
  await db.query("UPDATE marketing_automation_enrollments SET status='active'");
  await booking(16,1);
  assert.equal(await valid(),false,'rebooking stops the sequence before its next step');
  assert.equal((await db.query('SELECT status FROM marketing_automation_enrollments')).rows[0].status,'exited');
  assert.equal(await enroll(),0,'new booking has not crossed the configured threshold');
  await db.query("UPDATE bookings SET created_at=now()-interval '8 days' WHERE id=$1",[id(16)]);
  assert.equal(await enroll(),1,'the next lapsed cycle may enroll once after a new booking');
  enrollment = (await db.query('SELECT * FROM marketing_automation_enrollments')).rows[0];
  await db.query("UPDATE marketing_contacts SET status='unsubscribed'"); assert.equal(await valid(),false);
  await db.query("UPDATE marketing_contacts SET status='active'");
  await db.query("UPDATE marketing_automation_enrollments SET status='active'");
  await db.query("INSERT INTO slots VALUES($1,$2,now()+interval '1 day')",[id(30),id(1)]);
  await db.query('UPDATE bookings SET slot_id=$1 WHERE id=$2',[id(30),id(11)]);
  assert.equal(await valid(),false,'upcoming reservations suppress win-back email');
  for (const days of [null,0,1.5,3651]) {
    await db.query('SAVEPOINT invalid_days');
    await assert.rejects(db.query('UPDATE marketing_automations SET trigger_config=$1::jsonb',[JSON.stringify(days===null?{}:{days_since_last_booking:days})]),e=>e.code==='23514');
    await db.query('ROLLBACK TO SAVEPOINT invalid_days');
  }
  for (const fn of ['customer_booking_history(uuid,text,text,timestamptz,uuid,integer)','resolve_booking_discount(uuid,text,integer)','enroll_welcome_back_sequences(uuid,integer)','validate_welcome_back_enrollment(uuid,uuid)']) {
    const rights=(await db.query('SELECT has_function_privilege(\'anon\',$1,\'EXECUTE\') anon,has_function_privilege(\'authenticated\',$1,\'EXECUTE\') client',[fn])).rows[0];
    assert.deepEqual(rights,{anon:false,client:false});
  }
  console.log('PASS: previous booking history, normalized contacts, tenant boundaries, editable discount thresholds, zero/disabled offers, validation, email enrollment deduplication, rebooking/opt-out/future-booking exits and server-only RPC access');
} finally { await db.query('ROLLBACK'); await db.end(); }
