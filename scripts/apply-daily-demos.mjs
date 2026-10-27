// Applies only the user-requested daily demos, never the wider release ledger.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const mode=process.argv[2]||'plan';
assert(['plan','apply','verify'].includes(mode));
assert(process.env.SUPABASE_ACCESS_TOKEN && process.env.NEXT_PUBLIC_SUPABASE_URL,'Supabase Management credentials required');
const project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
assert.equal(project,'ukdsrndqhsatjkmxijuj','Unexpected project; refuse to mutate another environment');
const kayak='44ff11ab-c697-47de-9227-0ffa51db127c';
const claire='af17838c-fdd6-4b84-97c0-1cea39db7c0a';
const files=['20261001090000_repair_claires_demo_refresh.sql','20261001091000_kayak_daily_demo.sql'];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
async function query(sql,readOnly=true) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
    method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000),
  });
  const data=await response.json();
  if(!response.ok) throw new Error(`Demo SQL failed (${response.status}): ${JSON.stringify(data).slice(0,700)}`);
  return data;
}
const reportSql=`select jsonb_build_object(
  'day',(now() at time zone 'Africa/Johannesburg')::date,
  'kayak_bookings',(select count(*) from public.bookings where business_id='${kayak}' and source='DEMO'),
  'kayak_customers',(select count(*) from public.customers where business_id='${kayak}' and id::text like 'ca7a0de0-%'),
  'kayak_invoices',(select count(*) from public.invoices where business_id='${kayak}' and invoice_number like 'KAYAK-DEMO-%'),
  'kayak_departures_today',(select count(*) from public.slots where business_id='${kayak}' and id::text like 'ca7a0de0-%' and (start_time at time zone 'Africa/Johannesburg')::date=(now() at time zone 'Africa/Johannesburg')::date),
  'kayak_bookings_created_today',(select count(*) from public.bookings where business_id='${kayak}' and source='DEMO' and (created_at at time zone 'Africa/Johannesburg')::date=(now() at time zone 'Africa/Johannesburg')::date),
  'kayak_demo_notification_candidates',(select count(*) from public.bookings where business_id='${kayak}' and source='DEMO' and (phone is not null or marketing_opt_in or whatsapp_booking_updates_opt_in or not reminder_queued or not thankyou_queued or not review_prompted or yoco_payment_id is not null or yoco_checkout_id is not null or payment_url is not null)),
  'kayak_seat_or_invoice_mismatches',(select count(*) from public.bookings b join public.invoices i on i.id=b.invoice_id join public.slots s on s.id=b.slot_id where b.business_id='${kayak}' and b.source='DEMO' and (b.qty*b.unit_price<>b.total_amount or b.total_amount<>i.total_amount or s.start_time<>i.tour_date)),
  'claire_bookings_created_today',(select count(*) from public.bookings where business_id='${claire}' and id::text like 'c1a17e50-%' and (created_at at time zone 'Africa/Johannesburg')::date=(now() at time zone 'Africa/Johannesburg')::date),
  'claire_staged_slots',(select count(*) from public.slots where business_id='${claire}' and id::text like 'c1a17e50-%' and start_time>='2199-01-01'),
  'schedules',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule_utc',schedule,'active',active) order by jobname) from cron.job where jobname in ('refresh-kayak-demo-daily','refresh-claires-hiking-demo-daily'))
) report`;
if(mode==='verify') {console.log(JSON.stringify((await query(reportSql))[0].report,null,2));process.exit(0);}

const tenants=await query(`select id,subdomain,yoco_test_mode from public.businesses where id in ('${kayak}','${claire}')`);
assert(tenants.some(b=>b.id===kayak && b.subdomain==='kayak' && b.yoco_test_mode===true),'Kayak must remain in payment test mode');
assert(tenants.some(b=>b.id===claire && b.subdomain==='claires-hiking'),'Claire tenant mismatch');
const history=await query(`select version,name,statements from supabase_migrations.schema_migrations where version in (${files.map(f=>quote(f.slice(0,14))).join(',')})`);
const pending=[];
for(const file of files) {
  const source=readFileSync('supabase/migrations/'+file,'utf8');
  const installed=history.find(r=>r.version===file.slice(0,14));
  if(installed) assert.equal(installed.statements?.join('\n'),source,'Installed migration differs from the scoped source');
  else pending.push({file,source,sha256:createHash('sha256').update(source).digest('hex')});
}
console.log(JSON.stringify({project,tenants,pending:pending.map(({file,sha256})=>({file,sha256})),scope:'Demo records, three tour descriptions, Kayak branding and two existing-resource daily jobs; no provider calls or staff changes'}));
if(mode==='plan') {console.log(JSON.stringify((await query(reportSql))[0].report,null,2));process.exit(0);}
if(!pending.length) {console.log('The scoped demo migrations are already installed.');process.exit(0);}

const backup=mkdtempSync('/private/tmp/capekayak-daily-demos-');
const snapshot=await query(`select jsonb_build_object(
  'functions',(select jsonb_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('refresh_claires_hiking_demo_dates','refresh_kayak_demo')),
  'kayak_branding',(select jsonb_build_object('hero_eyebrow',hero_eyebrow,'hero_title',hero_title,'hero_subtitle',hero_subtitle,'hero_image',hero_image,'color_bg',color_bg,'what_to_bring',what_to_bring,'what_to_wear',what_to_wear,'footer_line_one',footer_line_one,'footer_line_two',footer_line_two) from public.businesses where id='${kayak}'),
  'kayak_tours',(select jsonb_agg(to_jsonb(t)) from public.tours t where business_id='${kayak}'),
  'kayak_original_bookings',(select jsonb_agg(to_jsonb(b)) from public.bookings b where business_id='${kayak}' and id::text not like 'ca7a0de0-%'),
  'claire_slots',(select jsonb_agg(to_jsonb(s)) from public.slots s where business_id='${claire}' and id::text like 'c1a17e50-%'),
  'claire_bookings',(select jsonb_agg(to_jsonb(b)) from public.bookings b where business_id='${claire}' and id::text like 'c1a17e50-%'),
  'claire_customers',(select jsonb_agg(to_jsonb(c)) from public.customers c where business_id='${claire}' and id::text like 'c1a17e50-%'),
  'claire_invoices',(select jsonb_agg(to_jsonb(i)) from public.invoices i where business_id='${claire}' and id::text like 'c1a17e50-%')
) snapshot`);
writeFileSync(backup+'/before.json',JSON.stringify({project,history,snapshot:snapshot[0].snapshot},null,2),{mode:0o600});
writeFileSync(backup+'/sources.json',JSON.stringify(pending,null,2),{mode:0o600});
console.log('Private rollback snapshot: '+backup+'/before.json');

const guards={
  bookings:`select md5(coalesce(jsonb_agg(to_jsonb(b) order by id)::text,'[]')) from public.bookings b where business_id='${kayak}' and id::text not like 'ca7a0de0-%'`,
  staff:`select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'[]')) from public.admin_users a where business_id in ('${kayak}','${claire}')`,
  prices:`select md5(coalesce(jsonb_agg(jsonb_build_object('id',id,'price',base_price_per_person,'capacity',default_capacity) order by id)::text,'[]')) from public.tours where business_id='${kayak}'`,
  usage:`select md5(coalesce(jsonb_agg(to_jsonb(u) order by business_id,period_key)::text,'[]')) from public.usage_counters u where business_id='${kayak}'`,
};
let sql=`begin; set local lock_timeout='5s'; set local statement_timeout='50s'; select set_config('request.jwt.claims','{"role":"service_role"}',true);
select id from public.bookings where business_id='${kayak}' and id::text not like 'ca7a0de0-%' for update;
select id from public.admin_users where business_id in ('${kayak}','${claire}') for update;
`;
for(const [name,guard] of Object.entries(guards)) sql+=`select set_config('demo_guard.${name}',(${guard}),true);\n`;
for(const {file,source} of pending) sql+=source+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values (${quote(file.slice(0,14))},${quote(file.slice(15,-4))},array[${quote(source)}]);\n`;
for(const [name,guard] of Object.entries(guards)) sql+=`do $$ begin if (${guard}) is distinct from current_setting('demo_guard.${name}') then raise exception 'Demo scope guard failed: ${name}'; end if; end $$;\n`;
sql+=`do $$ declare result jsonb; begin result:=public.refresh_kayak_demo('${kayak}'); if result->>'new_bookings'<>'0' or result->>'new_slots'<>'0' then raise exception 'Demo retry added duplicate records'; end if; end $$; commit;`;
await query(sql,false);
console.log(JSON.stringify({applied:pending.map(p=>p.file),retry:'Zero new records on retry',scopeGuards:'Original Kayak bookings, staff, prices, capacities and paid usage preserved'}));
const report=(await query(reportSql))[0].report;
writeFileSync(backup+'/verified.json',JSON.stringify(report,null,2),{mode:0o600});
assert(report.kayak_bookings>0 && report.kayak_invoices===report.kayak_bookings && report.kayak_bookings_created_today>0 && report.kayak_departures_today===3);
assert.equal(report.kayak_demo_notification_candidates,0);
assert.equal(report.kayak_seat_or_invoice_mismatches,0);
assert.equal(report.claire_staged_slots,0);
assert(report.claire_bookings_created_today>0);
assert(report.schedules.every(j=>j.active) && report.schedules.length===2);
console.log(JSON.stringify(report,null,2));
