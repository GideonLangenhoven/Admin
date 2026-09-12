// Deployment helper for this release. Reads credentials only from the process
// environment (node --env-file=.env.local); never prints keys or customer rows.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
assert(token, 'SUPABASE_ACCESS_TOKEN required');
const mode = process.argv[2] || 'inspect';
assert(['inspect', 'rehearse', 'apply', 'security'].includes(mode));
const files = readdirSync('supabase/migrations').filter(name => /^202609\d{8}_.*\.sql$/.test(name)).sort();
const pending = files.filter(name => name >= '20260911110000_');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query${readOnly ? '/read-only' : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({query: sql}), signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`SQL HTTP ${response.status}: ${JSON.stringify(result).slice(0,1000)}`);
  return result;
}

const history = await query('select version,name from supabase_migrations.schema_migrations order by version');
const definitions = await query("select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.prokind='f'");
const constraints = await query("select conrelid::regclass::text table_name,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace");
const policies = await query("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public'");
const columns = await query("select table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public'");
if (mode === 'security') {
  const baseline = JSON.parse(readFileSync('supabase/security-baseline.json','utf8'));
  const current = {
    // information_schema hides grants from the Management API's read-only role.
    grants: await query("SELECT r.rolname AS grantee,c.relname AS table_name,a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND c.relkind IN ('r','v','f','p') AND r.rolname IN ('anon','authenticated','service_role') ORDER BY grantee,table_name,privilege_type"),
    rls_status: await query("SELECT n.nspname AS schema,c.relname AS table_name,c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname='public' ORDER BY c.relname"),
    policies: await query("SELECT schemaname,tablename,policyname,cmd,roles,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname"),
  };
  // Match the SQL-standard privileges used by the scheduled drift checker.
  current.grants = current.grants.filter(row=>row.privilege_type!=='MAINTAIN');
  for (const [section, keys] of Object.entries({grants:['grantee','table_name','privilege_type'],rls_status:['table_name'],policies:['tablename','policyname']})) {
    const key = row => keys.map(k=>row[k]).join('|');
    const oldRows = new Map(baseline[section].map(row=>[key(row),row]));
    const newRows = new Map(current[section].map(row=>[key(row),row]));
    for (const [id,row] of newRows) {
      const before = oldRows.get(id);
      if (!before) console.log(JSON.stringify({section,change:'added',id,row}));
      else if (Object.keys(row).some(k=>JSON.stringify(before[k])!==JSON.stringify(row[k]))) console.log(JSON.stringify({section,change:'changed',id,before,after:row}));
    }
    for (const [id,row] of oldRows) if(!newRows.has(id))console.log(JSON.stringify({section,change:'removed',id,row}));
  }
  const path = mkdtempSync('/private/tmp/capekayak-security-')+'/proposed-baseline.json';
  writeFileSync(path,JSON.stringify({...baseline,...current,generated_at:new Date().toISOString(),note:baseline.note+' | 2026-09-12: reviewed deployed first-five release: independent booking proof, tenant-scoped insert/read policy, service-only durable refund operations.'},null,2)+'\n',{mode:0o600});
  console.log('Proposed baseline (review before adopting): '+path);
  process.exit(0);
}
const report = await query(`with amounts as (
  select total_captured, case when coalesce(original_total,0)>0
    and coalesce(total_amount,0)+coalesce(voucher_amount_paid,0)>original_total
    then greatest(0,original_total-coalesce(voucher_amount_paid,0)) else coalesce(total_amount,0) end cash
  from public.bookings where status in ('PAID','COMPLETED') and total_captured is not null
) select case when total_captured>cash then 'captured_high' else 'captured_low' end direction,
  count(*)::integer count from amounts where abs(total_captured-cash)>0.01 group by 1`);
const old = files.filter(name => name < '20260911110000_');
const installed = new Set(history.map(row => row.version));
const exists = name => definitions.some(row => row.proname === name);
const expected = ['prepare_booking_checkout','prepare_booking_amendment','confirm_booking_uplift','cancel_booking_transaction','reserve_refund_request','finish_refund_operation','account_manual_booking','apply_booking_change','save_checkout_request','record_unfulfilled_payment'];
console.log(JSON.stringify({project:ref, missingFunctions:expected.filter(name=>!exists(name)), historicalCaptureReport:report,
  pendingMigrations:pending.filter(name=>!installed.has(name.slice(0,14))), unrecordedEarlierMigrations:old.filter(name=>!installed.has(name.slice(0,14)))}));
if (mode === 'inspect') process.exit(0);

// These are the already-installed September batches, identified independently
// of the incomplete CLI ledger. Abort rather than mark an absent batch applied.
assert(exists('protect_platform_business_fields') && exists('current_business_ids'), 'Account boundary batch missing');
assert(exists('claim_marketing_queue') && exists('claim_marketing_automation_enrollments'), 'Queue batch missing');
assert(columns.some(c=>c.table_name==='marketing_automation_steps' && c.column_name==='template_id') && exists('clear_deleted_marketing_step_template'), 'Marketing relation batch missing');
assert(exists('list_operator_bookings'), 'Booking pagination batch missing');
assert(policies.some(p=>p.tablename==='bookings' && p.policyname==='bookings_read' && !p.qual.includes('x-booking-success-token')), 'Reference-only booking access remains');
assert(exists('claim_yoco_payment') && exists('confirm_booking_payment') && exists('r13_capture_report'), 'Payment hardening batches missing');
const backup = mkdtempSync('/private/tmp/capekayak-release-');
writeFileSync(backup+'/database-before.json', JSON.stringify({ref,history,definitions,constraints,policies,columns,report},null,2), {mode:0o600});
console.log('Private schema rollback evidence: '+backup+'/database-before.json');

let sql = "BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='50s'; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n";
for (const name of pending.filter(name=>!installed.has(name.slice(0,14)))) {
  const source = readFileSync('supabase/migrations/'+name,'utf8');
  const body = source.replace(/^\s*(BEGIN|COMMIT);\s*$/gim,'');
  sql += '\n'+body+'\n';
  sql += `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(name.slice(0,14))},${quote(name.slice(15,-4))},ARRAY[${quote(source)}]) ON CONFLICT(version) DO NOTHING;\n`;
  console.log(name+' sha256 '+createHash('sha256').update(source).digest('hex'));
}
for (const name of old.filter(name=>!installed.has(name.slice(0,14)))) {
  sql += `INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES(${quote(name.slice(0,14))},${quote(name.slice(15,-4))}) ON CONFLICT(version) DO NOTHING;\n`;
}
sql += "NOTIFY pgrst, 'reload schema';\n"+(mode==='apply'?'COMMIT;':'ROLLBACK;');
writeFileSync(backup+'/release.sql',sql,{mode:0o600});
await query(sql,false);
console.log(mode==='apply'?'APPLIED release transaction and reconciled September history':'PASS rehearsal; all database changes rolled back');
