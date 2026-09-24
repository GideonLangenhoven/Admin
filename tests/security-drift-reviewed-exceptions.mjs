import assert from 'node:assert/strict';
import { auditAdditionalSecurity } from '../scripts/security-drift-audit.mjs';

const onboarding = {
  name: 'get_my_admin_onboarding', args: '', owner: 'postgres', definer: true,
  settings: ['search_path=public'], definition_md5: '7415339ca0204127313d66d9dca063c6',
  client_owner: false, anon_execute: false, authenticated_execute: true, service_execute: true,
  client_grants: ['authenticated', 'service_role'],
};
const ownerOnly = {
  name: 'platform_onboard_business',
  args: 'p_actor_id uuid, p_request_id uuid, p_business jsonb, p_admin jsonb, p_credentials jsonb, p_key text',
  owner: 'postgres', definer: true, settings: ['search_path=public'],
  definition_md5: '5f52fd1e89f0b3377c2a59359801b97c',
  client_owner: false, anon_execute: false, authenticated_execute: false, service_execute: false,
  client_grants: [],
};
const directory = {
  name: 'operator_directory', owner: 'postgres', reloptions: null,
  anon_select: true, authenticated_select: true, service_select: true,
  view_md5: '1af5943aea01646e9ae6e8922b661f72',
};
const modeRead = {
  role: 'anon', relation: 'businesses', column_name: 'yoco_test_mode',
  privilege: 'SELECT', effective: true, table_effective: false, public_grant: false,
};

async function inspect({ functions = [onboarding, ownerOnly], views = [directory], columns = [modeRead] } = {}) {
  const client = { query: async sql => {
    if (sql.includes('from pg_proc p')) return { rows: functions };
    if (sql.includes("c.relkind in ('v','m')")) return { rows: views };
    if (sql.includes('join pg_attribute a')) return { rows: columns };
    if (sql.includes("from pg_namespace where nspname in")) return { rows: [{ schema: 'public', anon_create: false, authenticated_create: false, public_create: false }] };
    if (sql.includes("has_database_privilege('anon'")) return { rows: [{ anon_temp: true, authenticated_temp: true }] };
    if (sql.includes("to_regclass('storage.objects')")) return { rows: [{ objects_present: false, buckets_present: false }] };
    return { rows: [] };
  } };
  return auditAdditionalSecurity(client, { grants: [] });
}
const relevant = findings => findings.filter(finding =>
  finding.includes('Unconstrained search_path') || finding.includes('owner-rights view') ||
  finding.includes('businesses.yoco_test_mode'));

assert.deepEqual(relevant(await inspect()), []);
console.log('PASS exact reviewed function/view metadata and non-secret mode read');
for (const [label, changed] of [
  ['body', { definition_md5: 'changed' }],
  ['ACL', { client_grants: ['PUBLIC'] }],
  ['effective authority', { anon_execute: true }],
  ['owner', { owner: 'authenticated' }],
  ['signature', { args: 'changed uuid' }],
]) {
  const findings = await inspect({ functions: [{ ...onboarding, ...changed }] });
  assert(findings.some(finding => finding.includes('Unconstrained search_path on SECURITY DEFINER public.')),
    `${label} change was not detected`);
  console.log('PASS reviewed function ' + label + ' change detected');
}
assert(relevant(await inspect({ views: [{ ...directory, view_md5: 'changed' }] }))
  .some(finding => finding.includes('owner-rights view public.operator_directory')));
console.log('PASS reviewed directory definition change detected');
assert(relevant(await inspect({ columns: [{ ...modeRead, role: 'authenticated', privilege: 'UPDATE' }] }))
  .some(finding => finding.includes('Authenticated can update protected public.businesses.yoco_test_mode')));
console.log('PASS mode write protection remains');
