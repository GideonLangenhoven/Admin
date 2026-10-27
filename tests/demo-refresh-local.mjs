import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Never reads real credentials or accepts a remote database.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host), 'Use a disposable local PostgreSQL socket');
const connection = { host, port: Number(process.argv[3] || 5432), user: process.env.USER };
const database = 'demo_' + randomBytes(6).toString('hex');
const admin = new pg.Client({ ...connection, database: 'postgres' });
const db = new pg.Client({ ...connection, database });
const kayak = '44ff11ab-c697-47de-9227-0ffa51db127c';
const claire = 'af17838c-fdd6-4b84-97c0-1cea39db7c0a';
const other = '00000000-0000-4000-8000-000000000001';
const kayakTours = ['96e07644-315b-4e96-8f36-bb070b665cf8', '33910bd3-6826-4ee4-9dcc-4fcfcaf9097b', '8dbdf290-7a45-4bd9-a07e-77f0176b41ed'];
const cid = n => 'c1a17e50-0000-4000-8000-' + String(n).padStart(12, '0');
let passed = 0;
let created = false;
async function check(name, work) { await work(); passed++; console.log('PASS ' + name); }
async function refresh(day) { return (await db.query('select public.refresh_kayak_demo($1,$2) result', [kayak, day])).rows[0].result; }
async function snapshot() {
  return (await db.query(`select jsonb_build_object(
    'bookings',(select jsonb_agg(to_jsonb(b) order by id) from bookings b where source <> 'DEMO'),
    'slots',(select jsonb_agg(to_jsonb(s) order by id) from slots s where id::text not like 'ca7a0de0-%' and business_id <> $1),
    'staff',(select jsonb_agg(to_jsonb(a) order by id) from admin_users a),
    'other',(select to_jsonb(b) from businesses b where id=$2)
  ) state`, [claire, other])).rows[0].state;
}

try {
  await admin.connect();
  await admin.query('create database ' + database);
  created = true;
  await db.connect();
  await db.query(readFileSync('tests/fixtures/rollout-schema.sql', 'utf8'));
  await db.query(readFileSync('tests/fixtures/rollout-cron.sql', 'utf8'));
  await db.query(`
    create table invoices (
      id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id),
      booking_id uuid references bookings(id), invoice_number text not null,
      customer_name text, customer_email text, tour_name text, tour_date timestamptz,
      qty integer, unit_price numeric, subtotal numeric, total_amount numeric,
      payment_method text, payment_reference text, status text, created_at timestamptz default now(),
      unique(business_id,invoice_number)
    );
    alter table bookings add constraint bookings_invoice_id_fkey foreign key(invoice_id) references invoices(id);
    create table chat_messages (id uuid primary key, business_id uuid not null, created_at timestamptz);
    alter table conversations add column updated_at timestamptz;
    alter table bookings add column whatsapp_booking_updates_opt_in boolean not null default false;
    create function current_business_ids() returns uuid[] language sql as 'select array[]::uuid[]';
  `);
  await db.query(readFileSync('supabase/migrations/20260920100000_partial_booking_arrivals.sql', 'utf8'));
  // Real tenant constraints, including the immediate departure-time uniqueness.
  await db.query(`
    alter table tours add unique(id,business_id);
    alter table slots add unique(id,business_id,tour_id);
    alter table customers add unique(id,business_id);
    alter table bookings drop constraint if exists bookings_slot_id_fkey;
    alter table bookings add foreign key(slot_id,business_id,tour_id) references slots(id,business_id,tour_id);
    alter table bookings drop constraint if exists bookings_tour_id_fkey;
    alter table bookings add foreign key(tour_id,business_id) references tours(id,business_id);
    alter table bookings drop constraint if exists bookings_customer_id_fkey;
    alter table bookings add foreign key(customer_id,business_id) references customers(id,business_id);
    grant all on all tables in schema public to service_role;
  `);
  const day = (await db.query("select (now() at time zone 'Africa/Johannesburg')::date::text as current_day")).rows[0].current_day;
  const at = offset => new Date(Date.parse(day + 'T10:00:00+02:00') + offset * 86400000).toISOString();
  await db.query(`insert into businesses(id,name,operator_email,subdomain,yoco_test_mode) values
    ($1,'Kayak','demo@example.invalid','kayak',true),
    ($2,'Claire','claire@example.invalid','claires-hiking',true),
    ($3,'Other','other@example.invalid','other',true)`, [kayak, claire, other]);
  await db.query("insert into admin_users(business_id,email,password_hash,role,name) values($1,'kayak-staff@example.invalid','unchanged','MAIN_ADMIN','Existing operator')", [kayak]);
  for (const [i,id] of kayakTours.entries()) {
    await db.query('insert into tours(id,business_id,name,base_price_per_person,default_capacity,duration_minutes,sort_order) values($1,$2,$3,$4,$5,120,$6)', [id,kayak,['Morning Kayak','Sunset Paddle','Midday Hike'][i],[600,500,700][i],i===0?20:10,i]);
    await db.query(`insert into slots(business_id,tour_id,start_time,capacity_total)
      select $1,$2,(($3::date+n)+$4::time) at time zone 'Africa/Johannesburg',$5 from generate_series(-2,30) n`, [kayak,id,day,['09:00','18:00','09:30'][i],i===0?20:10]);
  }
  await db.query(`insert into bookings(business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status,source,yoco_payment_id)
    select business_id,tour_id,id,'Original provider booking','original@example.invalid',2,600,1200,'PAID','WEB','original-test-payment'
    from slots where tour_id=$1 order by start_time limit 1`, [kayakTours[0]]);
  for(let n=101;n<=105;n++) await db.query('insert into tours(id,business_id,name,base_price_per_person,default_capacity) values($1,$2,$3,500,20)',[cid(n),claire,'Demo hike '+n]);
  // Use the previously provisioned fixture as the regression input, not dates
  // synthesized from the new refresh implementation.
  const provisioning = readFileSync('scripts/provision-demo-account.mjs','utf8');
  const slotsText = provisioning.split('const slotRows = [')[1].split('].map')[0];
  const slotRows = [...slotsText.matchAll(/\[([\d,\s-]+)\]/g)].map(m=>JSON.parse('['+m[1]+']'));
  assert.equal(slotRows.length,34);
  for(const [id,tour,offset,hour,minute,capacity,booked] of slotRows) {
    await db.query(`insert into slots(id,business_id,tour_id,start_time,capacity_total,booked)
      values($1,$2,$3,(($4::date+$5::integer)+$6::time) at time zone 'Africa/Johannesburg',$7,$8)`,
      [cid(id),claire,cid(tour),day,offset-4,`${hour}:${String(minute).padStart(2,'0')}`,capacity,booked]);
  }
  for (const n of [343,350]) await db.query(`insert into bookings(id,business_id,tour_id,customer_name,email,qty,unit_price,total_amount,status,source)
    values($1,$2,$3,'Claire fixture','claire-guest@example.invalid',1,500,500,'CONFIRMED','DEMO')`, [cid(n),claire,cid(n===343?101:104)]);
  await db.query(readFileSync('supabase/migrations/20260916100000_expand_claires_demo_fixture.sql','utf8'));
  await db.query("alter table marketing_contacts add unique(business_id,email)");
  await db.query(readFileSync('supabase/migrations/20260710120000_marketing_contact_auto_sync.sql','utf8'));
  const contactsBefore=(await db.query('select count(*)::int n from marketing_contacts where business_id=$1',[kayak])).rows[0].n;
  await check('reproduces the existing Claire departure collision',async()=>{
    await assert.rejects(db.query('select refresh_claires_hiking_demo_dates($1,$2)',[claire,at(-3)]),error=>error.code==='23505');
  });
  const originals = await snapshot();

  // A local guard rejects ANY new counted paid booking. This proves the demo
  // works even with no allowance and cannot create subscription usage events.
  await db.query(`create function fixture_paid_guard() returns trigger language plpgsql as $$begin
    if new.status='PAID' and new.total_amount>0 then raise exception 'No paid booking allowance'; end if;
    return new; end$$;
    create trigger fixture_paid_guard before insert or update of status on bookings for each row execute function fixture_paid_guard();`);
  await db.query(readFileSync('supabase/migrations/20261001090000_repair_claires_demo_refresh.sql','utf8'));
  await db.query(readFileSync('supabase/migrations/20261001091000_kayak_daily_demo.sql','utf8'));
  await check('daily fixture has bookings, paid demo invoices, customers and available departures',async()=>{
    const counts=(await db.query(`select
      (select count(*)::int from bookings where business_id=$1 and source='DEMO') bookings,
      (select count(*)::int from invoices where business_id=$1) invoices,
      (select count(*)::int from customers where business_id=$1) customers,
      (select count(*)::int from slots where business_id=$1 and id::text like 'ca7a0de0-%') slots`,[kayak])).rows[0];
    assert.deepEqual(counts,{bookings:129,invoices:129,customers:12,slots:177});
    assert.equal((await db.query("select count(*)::int n from bookings where business_id=$1 and source='DEMO' and (created_at at time zone 'Africa/Johannesburg')::date=$2::date",[kayak,day])).rows[0].n>0,true);
  });
  await check('same-day retries add no duplicate records',async()=>{
    assert.deepEqual(await refresh(at(0)),{day,new_bookings:0,new_slots:0});
  });
  await check('tomorrow adds fresh bookings without moving yesterday’s bookings',async()=>{
    const before=(await db.query("select jsonb_agg(jsonb_build_object('id',id,'slot_id',slot_id,'created_at',created_at) order by id) rows from bookings where source='DEMO' and business_id=$1",[kayak])).rows[0].rows;
    assert.equal((await refresh(at(1))).new_bookings,3);
    const after=(await db.query("select jsonb_agg(jsonb_build_object('id',id,'slot_id',slot_id,'created_at',created_at) order by id) rows from bookings where source='DEMO' and business_id=$1 and id=any($2::uuid[])",[kayak,before.map(b=>b.id)])).rows[0].rows;
    assert.deepEqual(after,before);
    assert.equal((await db.query("select count(*)::int n from bookings where business_id=$1 and source='DEMO' and (created_at at time zone 'Africa/Johannesburg')::date=($2::date+1)",[kayak,day])).rows[0].n,3);
  });
  await check('multi-day catch-up and backward date checks stay idempotent',async()=>{
    assert.equal((await refresh(at(8))).new_bookings,21);
    assert.equal((await refresh(at(-1))).new_bookings,3);
    assert.equal((await refresh(at(8))).new_bookings,0);
  });
  await check('South African midnight produces current-day activity',async()=>{
    const midnight = new Date(Date.parse(at(9))-10*3600000+7*60000).toISOString();
    await refresh(midnight);
    const count=(await db.query("select count(*)::int n from bookings where business_id=$1 and source='DEMO' and (created_at at time zone 'Africa/Johannesburg')::date=($2::date+9) and created_at <= $3::timestamptz",[kayak,day,midnight])).rows[0].n;
    assert.equal(count,3);
  });
  await check('concurrent refreshes serialize without duplicate bookings',async()=>{
    const clients=[new pg.Client({...connection,database}),new pg.Client({...connection,database})];
    try {
      await Promise.all(clients.map(c=>c.connect()));
      const results=await Promise.all(clients.map(c=>c.query('select refresh_kayak_demo($1,$2) result',[kayak,at(10)])));
      assert.deepEqual(results.map(r=>r.rows[0].result.new_bookings).sort((a,b)=>a-b),[0,3]);
    } finally { await Promise.all(clients.map(c=>c.end())); }
  });
  await check('guest counts, money, arrival states and invoices agree',async()=>{
    const invalid=(await db.query(`select count(*)::int n from bookings b join slots s on s.id=b.slot_id join invoices i on i.id=b.invoice_id
      where b.business_id=$1 and b.source='DEMO' and (
        b.qty*b.unit_price <> b.total_amount or b.total_captured <> b.total_amount
        or b.total_amount <> i.total_amount or s.start_time <> i.tour_date
        or i.booking_id <> b.id or b.checked_in <> (b.arrived_count=b.qty)
      )`,[kayak])).rows[0].n;
    assert.equal(invalid,0);
    assert.equal((await db.query(`select count(*)::int n from slots s where business_id=$1 and id::text like 'ca7a0de0-%'
      and (booked+held>capacity_total or booked <> coalesce((select sum(qty) from bookings b where b.slot_id=s.id and b.status in ('PAID','CONFIRMED','COMPLETED','PENDING')),0))`,[kayak])).rows[0].n,0);
  });
  await check('synthetic records cannot queue guest messaging or provider payments',async()=>{
    assert.equal((await db.query(`select count(*)::int n from bookings where business_id=$1 and source='DEMO' and (
      phone is not null or marketing_opt_in or whatsapp_booking_updates_opt_in or not reminder_queued
      or not thankyou_queued or not review_prompted or confirmation_sent_at is null
      or email not like '%@anonymized.local' or yoco_payment_id is not null or yoco_checkout_id is not null or payment_url is not null
    )`,[kayak])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from holds')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from net.fixture_requests')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from marketing_contacts where business_id=$1',[kayak])).rows[0].n,contactsBefore);
  });
  await check('foreign tenants and non-test-mode Kayak calls do nothing',async()=>{
    assert.equal((await db.query('select refresh_kayak_demo($1,$2) result',[other,at(20)])).rows[0].result,null);
    await db.query('update businesses set yoco_test_mode=false where id=$1',[kayak]);
    assert.equal(await refresh(at(20)),null);
    await db.query('update businesses set yoco_test_mode=true where id=$1',[kayak]);
    assert.deepEqual(await snapshot(),originals);
  });
  await check('Claire rolls forward repeatedly without departure collisions',async()=>{
    for(const offset of [1,1,7,30,-1,0]) {
      await db.query('select refresh_claires_hiking_demo_dates($1,$2)',[claire,at(offset)]);
      assert.equal((await db.query("select count(*)::int n from slots where business_id=$1 and start_time>='2199-01-01'",[claire])).rows[0].n,0);
    }
    assert.equal((await db.query("select count(*)::int n from bookings where business_id=$1 and (created_at at time zone 'Africa/Johannesburg')::date=$2::date",[claire,day])).rows[0].n,2);
    assert.deepEqual(await snapshot(),originals);
  });
  await check('refresh is service-only and cron runs daily at 00:07 South African time',async()=>{
    for(const role of ['anon','authenticated']) assert.equal((await db.query("select has_function_privilege($1,'refresh_kayak_demo(uuid,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('service_role','refresh_kayak_demo(uuid,timestamptz)','EXECUTE') allowed")).rows[0].allowed,true);
    assert.equal((await db.query("select schedule from cron.job where jobname='refresh-kayak-demo-daily'")).rows[0].schedule,'7 22 * * *');
  });
  await check('a fully reserved departure receives no demo bookings or overwritten capacity',async()=>{
    await db.query('begin');
    try {
      const slot=(await db.query(`select s.* from slots s where business_id=$1 and tour_id=$2
        and (start_time at time zone 'Africa/Johannesburg')::date=$3::date+25 and id::text like 'ca7a0de0-%'`,[kayak,kayakTours[0],day])).rows[0];
      await db.query('update slots set held=capacity_total where id=$1',[slot.id]);
      assert.equal((await refresh(at(11))).new_bookings,2);
      assert.equal((await db.query('select held,booked from slots where id=$1',[slot.id])).rows[0].held,slot.capacity_total);
      assert.equal((await db.query('select count(*)::int n from bookings where slot_id=$1',[slot.id])).rows[0].n,0);
    } finally { await db.query('rollback'); }
  });
  await check('operator-created departures win unique-time conflicts without being moved',async()=>{
    await db.query('begin');
    try {
      const slot=(await db.query(`insert into slots(business_id,tour_id,start_time,capacity_total)
        values($1,$2,(($3::date+59)+time '08:30') at time zone 'Africa/Johannesburg',20) returning *`,[kayak,kayakTours[0],day])).rows[0];
      await refresh(at(45));
      assert.deepEqual((await db.query('select * from slots where id=$1',[slot.id])).rows[0],slot);
      assert.equal((await db.query('select count(*)::int n from bookings where slot_id=$1',[slot.id])).rows[0].n,0);
    } finally { await db.query('rollback'); }
  });
  await check('daily runs preserve operator cancellations of a synthetic booking',async()=>{
    await db.query('begin');
    try {
      const id=(await db.query("select id from bookings where business_id=$1 and source='DEMO' and status='CONFIRMED' limit 1",[kayak])).rows[0].id;
      await db.query("update bookings set status='CANCELLED',cancellation_reason='Operator demo action' where id=$1",[id]);
      await refresh(at(11));
      assert.equal((await db.query('select status from bookings where id=$1',[id])).rows[0].status,'CANCELLED');
    } finally { await db.query('rollback'); }
  });
  console.log(`PASS ${passed} demo database checks`);
} finally {
  await db.end();
  if(created) await admin.query('drop database ' + database + ' with (force)');
  await admin.end();
}
