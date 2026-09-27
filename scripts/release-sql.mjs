// Exact staged release helper. `plan` is offline; hosted modes read
// credentials only from the process environment and never print customer rows.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2];
assert(['plan', 'inspect', 'rehearse', 'apply', 'security', 'health'].includes(mode), 'Choose plan, inspect, rehearse, apply, security, or health');
const stageAt = process.argv.indexOf('--stage');
const stage = stageAt < 0 ? 'six' : process.argv[stageAt + 1];
assert(['six','shared-ingress'].includes(stage), 'Choose the six or shared-ingress stage');
const projectRef = 'ukdsrndqhsatjkmxijuj';
const sixMigrations = [
  ['20260923100000_guide_photo_upload_recovery.sql', '5e94d682e31bc1a89914ac74514fc73aa9e175fb8b4ae2ea22c0b1f86bab39df'],
  ['20260923110000_exact_staff_roles_and_demo_rpc_acl.sql', '5cc2fd8525338cde3788d7188815dda793516bdaffc3071956f608643f21a5e0'],
  ['20260923120000_storage_exact_staff_roles.sql', '274f370d7023168d5e3ed276e68a78b74e830c59cac7bc062726cbea7cc523a8'],
  ['20260923130000_refund_batch_acceptance.sql', '9e1c20d036b7fa9adc4819dd145920aec3090e8c59a24e62d3b3c572a5f810aa'],
  ['20260923140000_waiver_and_client_trigger_paths.sql', 'fd10cf0638023b429e4748c613a3ef986ec224977a683cb0260776f6f5c0f522'],
  ['20260925120000_check_ins_policy_hoisted.sql', '5ce995eeb764e46a46b663f03304937767b6c1907aed90f5dcf0252d534da37a'],
];
const ingressMigration = ['20260927100000_shared_ingress_rate_limit.sql', '10531c48de4dd8ab8e466fd364aebaa2e6fda3d5782bec52fed38434596f7ffe'];
const migrations = stage === 'six' ? sixMigrations : [ingressMigration];
const ledgerBefore = stage === 'six' ? { count: 215, latest: '20260922123000' } : { count: 221, latest: '20260925120000' };
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const names = migrations.map(([name]) => name);
const source = migrations.map(([name, expectedHash]) => {
  const contents = readFileSync('supabase/migrations/' + name, 'utf8');
  assert.equal(hash(contents), expectedHash, `Migration changed: ${name}`);
  assert.equal((contents.match(/^\s*begin;[ \t]*$/gim) || []).length, 1, `Expected one outer BEGIN: ${name}`);
  assert.equal((contents.match(/^\s*commit;[ \t]*$/gim) || []).length, 1, `Expected one outer COMMIT: ${name}`);
  return contents;
});
const manifest = JSON.parse(readFileSync('docs/production-readiness/RELEASE_MANIFEST.json', 'utf8'));
const listed = manifest.planned_unapplied_migrations;
assert.deepEqual(listed.slice(0, sixMigrations.length), sixMigrations.map(([name]) => 'supabase/migrations/' + name), 'Release manifest and original six differ');
assert(listed.length === sixMigrations.length ||
  (listed.length === sixMigrations.length + 1 && listed.at(-1) === 'supabase/migrations/' + ingressMigration[0]),
  'Release manifest has an unexpected migration');
if (stage === 'shared-ingress') assert.equal(listed.length, sixMigrations.length + 1, 'Shared ingress must be listed in the release manifest');
const septemberFiles = readdirSync('supabase/migrations').filter(name => /^202609\d{8}_.*\.sql$/.test(name)).sort();
const earlierSeptember = septemberFiles.filter(name => name <= `${ledgerBefore.latest}_zzzz.sql`);
assert.equal(earlierSeptember.length, stage === 'six' ? 34 : 40, 'Earlier September candidate ledger set changed');
assert.deepEqual(septemberFiles.filter(name => name > `${ledgerBefore.latest}_zzzz.sql`),
  stage === 'six' ? [...sixMigrations.map(([name]) => name), ingressMigration[0]] : names, 'Unexpected later September migration');

function sqlFor(rehearsal = false) {
  const versions = names.map(name => quote(name.slice(0, 14))).join(',');
  const priorPairs = earlierSeptember.map(name => `(${quote(name.slice(0,14))},${quote(name.slice(15,-4))})`).join(',');
  const postflight = stage === 'six' ? `
    OR to_regclass('public.guide_photo_uploads') IS NULL
    OR to_regclass('public.refund_batches') IS NULL
    OR to_regprocedure('public.claim_refund_batch_item(uuid,uuid)') IS NULL
    OR to_regprocedure('public.record_refund_batch_item(uuid,uuid,jsonb)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='slot_check_ins' AND policyname='check_ins_admin')` : `
    OR to_regclass('public.ingress_rate_limits') IS NULL
    OR to_regprocedure('public.check_ingress_rate_limit(text,text,integer,integer)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ingress_rate_limits_expiry_idx')
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.ingress_rate_limits'::regclass AND relrowsecurity)`;
  let sql = `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='50s';
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> ${ledgerBefore.count}
    OR (SELECT max(version) FROM supabase_migrations.schema_migrations) <> ${quote(ledgerBefore.latest)}
    OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${versions}))
    OR EXISTS (
      SELECT 1 FROM (VALUES ${priorPairs}) expected(version,name)
      LEFT JOIN supabase_migrations.schema_migrations actual USING(version)
      WHERE actual.name IS DISTINCT FROM expected.name
    )
  THEN RAISE EXCEPTION 'Release migration ledger changed; inspect and reconcile before retry';
  END IF;
END $preflight$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
`;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    sql += '\n' + source[i].replace(/^\s*(BEGIN|COMMIT);[ \t]*$/gim, '') + '\n';
    sql += `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(name.slice(0,14))},${quote(name.slice(15,-4))},ARRAY[${quote(source[i])}]);\n`;
  }
  sql += `DO $postflight$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${versions})) <> ${names.length}${postflight}
  THEN RAISE EXCEPTION 'Release migration postflight failed';
  END IF;
END $postflight$;
${rehearsal ? 'ROLLBACK' : 'COMMIT'};
`;
  return sql;
}
const applySql = sqlFor();
const sqlSha256 = hash(applySql);
if (mode === 'plan') {
  const dir = mkdtempSync(join(tmpdir(), stage === 'six' ? 'capekayak-six-migrations-' : 'capekayak-shared-ingress-'));
  const sqlPath = dir + '/apply.sql';
  const rehearsalSqlPath = dir + '/rehearse.sql';
  writeFileSync(sqlPath, applySql, { mode: 0o600 });
  writeFileSync(rehearsalSqlPath, sqlFor(true), { mode: 0o600 });
  console.log(JSON.stringify({ stage, projectRef, ledgerBefore, migrations: migrations.map(([name, sha256]) => ({name, sha256})), sqlSha256, sqlPath, rehearsalSqlPath }, null, 2));
  process.exit(0);
}

function option(name) {
  const at = process.argv.indexOf(name);
  assert(at >= 0 && at + 1 < process.argv.length, `${name} required`);
  return process.argv[at + 1];
}
if (mode === 'apply' || mode === 'rehearse') {
  assert.equal(option('--project-ref'), projectRef, 'Project ref differs from reviewed target');
  assert.equal(option('--sql-sha256'), sqlSha256, 'SQL digest differs from reviewed plan');
}
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
assert.equal(ref, projectRef, 'Environment project differs from reviewed target');
const token = process.env.SUPABASE_ACCESS_TOKEN;
assert(token, 'SUPABASE_ACCESS_TOKEN required');
async function query(sql, readOnly = true) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query${readOnly ? '/read-only' : ''}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({query: sql}), signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('Management API request failed; check connectivity and inspect state before retry');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error(`SQL HTTP ${response.status}: unreadable response`); }
  if (!response.ok) {
    const code = result?.code ?? result?.error?.code;
    throw new Error(`SQL HTTP ${response.status}${typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? ` SQLSTATE ${code}` : ''}`);
  }
  return result;
}

if (mode === 'health') {
  console.log(JSON.stringify({recentScheduledHttp:await query("SELECT status_code,timed_out,case when error_msg like 'Timeout%' then 'Request timeout' else error_msg end error,count(*)::int requests,max(created) latest FROM net._http_response WHERE created>now()-interval '10 minutes' GROUP BY 1,2,3 ORDER BY status_code")}));
  console.log(JSON.stringify({cleanupWorkerResults:await query("SELECT created,status_code,(content::jsonb->'reminders'->>'ok')::boolean reminders_ok,jsonb_array_length(content::jsonb->'errors') internal_error_count FROM net._http_response WHERE created>now()-interval '10 minutes' AND status_code=200 AND content like '%\"hold_cleanup\"%' ORDER BY created DESC")}));
  console.log(JSON.stringify({scheduledRuns:await query("SELECT j.jobname,r.status,count(*)::int runs,max(r.start_time) latest FROM cron.job_run_details r JOIN cron.job j USING(jobid) WHERE r.start_time>now()-interval '30 minutes' GROUP BY j.jobname,r.status ORDER BY j.jobname,r.status")}));
  process.exit(0);
}
const history = await query('select version,name from supabase_migrations.schema_migrations order by version');
async function readCatalog() {
  const definitions = await query("select n.nspname schema,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proacl::text acl,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname in ('public','storage','auth') and p.prokind in ('f','p') order by n.nspname,p.proname,args");
  const constraints = await query("select conrelid::regclass::text table_name,conname,pg_get_constraintdef(oid) definition,convalidated from pg_constraint where connamespace in ('public'::regnamespace,'storage'::regnamespace) order by table_name,conname");
  const policies = await query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname");
  const columns = await query("select table_schema,table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema in ('public','storage') order by table_schema,table_name,column_name");
  const relations = await query("select n.nspname schema,c.relname,c.relkind,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,c.reloptions,case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end view_definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m','f','S') order by n.nspname,c.relname");
  const triggers = await query("select n.nspname schema,c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and not t.tgisinternal order by n.nspname,c.relname,t.tgname");
  const indexes = await query("select n.nspname schema,c.relname table_name,i.relname index_name,pg_get_indexdef(i.oid) definition,x.indisvalid,x.indisready,x.indislive from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') order by n.nspname,c.relname,i.relname");
  const schemas = await query("select nspname,pg_get_userbyid(nspowner) owner,nspacl::text acl from pg_namespace where nspname in ('public','storage','auth') order by nspname");
  const roleMemberships = await query("select member.rolname member,role.rolname role from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles role on role.oid=m.roleid where member.rolname in ('anon','authenticated','service_role') order by member.rolname,role.rolname");
  return {definitions,constraints,policies,columns,relations,triggers,indexes,schemas,roleMemberships};
}
const catalog = await readCatalog();
const {definitions,constraints,policies,columns} = catalog;
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
  const path = mkdtempSync(join(tmpdir(), 'capekayak-security-'))+'/proposed-baseline.json';
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
const installed = new Map(history.map(row => [row.version, row.name]));
const exists = name => definitions.some(row => row.proname === name);
const expected = ['prepare_booking_checkout','prepare_booking_amendment','confirm_booking_uplift','cancel_booking_transaction','reserve_refund_request','finish_refund_operation','account_manual_booking','apply_booking_change','save_checkout_request','record_unfulfilled_payment'];
const ledgerSha256 = hash(JSON.stringify(history));
const catalogSha256 = hash(JSON.stringify(catalog));
const priorMismatch = earlierSeptember.filter(name => installed.get(name.slice(0,14)) !== name.slice(15,-4));
const candidateInstalled = names.filter(name => installed.has(name.slice(0,14)));
const ledgerMatches = history.length === ledgerBefore.count && history.at(-1)?.version === ledgerBefore.latest && !priorMismatch.length && !candidateInstalled.length;
console.log(JSON.stringify({project:ref, ledgerCount:history.length, ledgerLatest:history.at(-1)?.version, ledgerSha256, catalogSha256,
  ledgerMatches, priorMismatch, candidateInstalled, missingFunctions:expected.filter(name=>!exists(name)), historicalCaptureReport:report}));
if (mode === 'inspect') process.exit(0);

assert(ledgerMatches, 'Ledger differs from exact six-migration preflight; inspect and reconcile');
// These installed functions and policies are prerequisites for the six changes.
assert(exists('protect_platform_business_fields') && exists('current_business_ids'), 'Account boundary batch missing');
assert(exists('claim_marketing_queue') && exists('claim_marketing_automation_enrollments'), 'Queue batch missing');
assert(columns.some(c=>c.table_name==='marketing_automation_steps' && c.column_name==='template_id') && exists('clear_deleted_marketing_step_template'), 'Marketing relation batch missing');
assert(exists('list_operator_bookings'), 'Booking pagination batch missing');
assert(policies.some(p=>p.tablename==='bookings' && p.policyname==='bookings_read' && !p.qual.includes('x-booking-success-token')), 'Reference-only booking access remains');
assert(exists('claim_yoco_payment') && exists('confirm_booking_payment') && exists('r13_capture_report'), 'Payment hardening batches missing');
const backup = mkdtempSync(join(tmpdir(), 'capekayak-release-'));
const beforePath = backup+'/database-before.json';
writeFileSync(beforePath, JSON.stringify({ref,ledgerSha256,catalogSha256,history,catalog,report},null,2), {mode:0o600});
console.log('Private schema rollback evidence: '+beforePath);
if (mode === 'rehearse') {
  await query(sqlFor(true), false);
  const after = await query('select version,name from supabase_migrations.schema_migrations order by version');
  assert.equal(hash(JSON.stringify(after)), ledgerSha256, 'Rehearsal changed migration ledger');
  assert.equal(hash(JSON.stringify(await readCatalog())), catalogSha256, 'Rehearsal changed schema catalog');
  const receiptPath = backup+'/rehearsal.json';
  writeFileSync(receiptPath, JSON.stringify({stage,projectRef:ref,sqlSha256,ledgerSha256,catalogSha256,recordedAt:new Date().toISOString()},null,2)+'\n', {mode:0o600});
  console.log('PASS rehearsal; transaction rolled back. Receipt: '+receiptPath);
} else {
  const receipt = JSON.parse(readFileSync(option('--rehearsal-receipt'), 'utf8'));
  assert.equal(receipt.stage ?? 'six', stage, 'Rehearsal stage differs');
  assert.equal(receipt.projectRef, ref, 'Rehearsal project differs');
  assert.equal(receipt.sqlSha256, sqlSha256, 'Rehearsal plan differs');
  assert.equal(receipt.ledgerSha256, ledgerSha256, 'Ledger changed since rehearsal');
  assert.equal(receipt.catalogSha256, catalogSha256, 'Schema changed since rehearsal');
  const age = Date.now() - Date.parse(receipt.recordedAt);
  assert(age >= 0 && age <= 30*60*1000, 'Rehearsal receipt older than 30 minutes');
  try {
    await query(applySql, false);
  } catch {
    throw new Error('UNKNOWN_APPLY_OUTCOME: inspect ledger and objects before any retry');
  }
  try {
    const after = await query('select version,name from supabase_migrations.schema_migrations order by version');
    assert.equal(after.length, ledgerBefore.count + names.length);
    assert.deepEqual(after.slice(-names.length), names.map(name => ({version:name.slice(0,14),name:name.slice(15,-4)})));
  } catch {
    throw new Error('APPLIED_BUT_UNVERIFIED: inspect ledger and objects before any retry');
  }
  console.log(`APPLIED exact ${stage} transaction; read-only ledger verification passed`);
}
