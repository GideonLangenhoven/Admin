#!/usr/bin/env node
// Synthetic loopback PostgreSQL fixture. Never reads DATABASE_URL or .env.local.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import pg from 'pg';
import { secureClientConfig } from '../scripts/check-security-drift.mjs';
import { auditAdditionalSecurity } from '../scripts/security-drift-audit.mjs';

const root = mkdtempSync(join(process.env.C05_EVIDENCE_DIR || tmpdir(), 'c05-db-'));
const pgBin = process.env.POSTGRES_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
let started = false;
let admin;

async function connect(url, environment = {}) {
  const client = new pg.Client(secureClientConfig(url.toString(), environment));
  try {
    await client.connect();
    await client.query('select 1');
  } finally {
    await client.end().catch(() => {});
  }
}
async function expectTlsFailure(name, url, environment = {}) {
  await assert.rejects(connect(url, environment), name);
  console.log('PASS ' + name);
}
async function findingAfter(sql, fragment) {
  await admin.query('begin');
  try {
    await admin.query(sql);
    const findings = await auditAdditionalSecurity(admin, { grants: [] });
    assert(findings.some(x => x.includes(fragment)), `${fragment} not detected: ${findings.join('; ')}`);
  } finally {
    await admin.query('rollback');
  }
  console.log('PASS drift: ' + fragment);
}

try {
  const data = join(root, 'data');
  run(join(pgBin, 'initdb'), ['-D', data, '--auth-local=trust', '--auth-host=trust', '--no-instructions']);
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=C05 Local CA', '-keyout', join(root, 'ca.key'), '-out', join(root, 'ca.crt'), '-days', '1']);
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', join(root, 'server.key'), '-out', join(root, 'server.csr')]);
  writeFileSync(join(root, 'server.ext'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  run('openssl', ['x509', '-req', '-in', join(root, 'server.csr'), '-CA', join(root, 'ca.crt'), '-CAkey', join(root, 'ca.key'), '-CAcreateserial', '-out', join(root, 'server.crt'), '-days', '1', '-extfile', join(root, 'server.ext')]);
  chmodSync(join(root, 'server.key'), 0o600);
  run(join(pgBin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-c listen_addresses=localhost -c port=${port} -c ssl=on -c ssl_cert_file=${join(root, 'server.crt')} -c ssl_key_file=${join(root, 'server.key')}`, 'start']);
  started = true;

  const url = new URL(`postgresql://${encodeURIComponent(process.env.USER)}@localhost:${port}/postgres`);
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslrootcert', join(root, 'ca.crt'));
  await connect(url);
  assert.equal(new pg.Client(secureClientConfig(url.toString(), {})).ssl.rejectUnauthorized, true);
  console.log('PASS trusted CA, hostname and sslmode=require override');

  const noCa = new URL(url); noCa.searchParams.delete('sslrootcert');
  await expectTlsFailure('untrusted certificate', noCa);
  const wrongHost = new URL(url); wrongHost.hostname = '127.0.0.1';
  await expectTlsFailure('wrong hostname', wrongHost);
  const overriddenHost = new URL(url); overriddenHost.searchParams.set('host', '127.0.0.1');
  await expectTlsFailure('connection-string host override mismatch', overriddenHost);
  const duplicateHost = new URL(url); duplicateHost.searchParams.append('host', 'localhost'); duplicateHost.searchParams.append('host', '127.0.0.1');
  await expectTlsFailure('duplicate connection-string host override', duplicateHost);
  const wrongCa = new URL(url); wrongCa.searchParams.set('sslrootcert', join(root, 'server.crt'));
  await expectTlsFailure('wrong trust anchor', wrongCa);
  for (const [name, alter] of [
    ['sslmode=disable', u => u.searchParams.set('sslmode', 'disable')],
    ['sslmode=verify-ca', u => u.searchParams.set('sslmode', 'verify-ca')],
    ['ssl=no-verify override', u => u.searchParams.set('ssl', 'no-verify')],
    ['libpq compatibility override', u => u.searchParams.set('uselibpqcompat', 'true')],
  ]) {
    const candidate = new URL(url); alter(candidate);
    await expectTlsFailure(name, candidate);
  }
  await expectTlsFailure('insecure PGSSLMODE environment', noCa, { PGSSLMODE: 'no-verify' });
  await expectTlsFailure('disabled Node TLS validation', url, { NODE_TLS_REJECT_UNAUTHORIZED: '0' });

  admin = new pg.Client(secureClientConfig(url.toString(), {}));
  await admin.connect();
  await admin.query(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema storage;
    create table storage.objects(bucket_id text, name text);
    create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    alter table storage.objects enable row level security;
    create function public.block_read_only_admin_write() returns trigger language plpgsql
      security definer set search_path=public,pg_temp as $$begin return new; end$$;
    create trigger block_read_only_admin_write before insert on storage.objects
      for each row execute function public.block_read_only_admin_write();
    create policy "Anon upload of onboarding assets" on storage.objects for insert to anon
      with check(bucket_id='onboarding-assets');
    create function storage.foldername(text) returns text[] language sql immutable
      as $$select string_to_array($1,'/')$$;
    create function public.storage_admin_business_ids() returns setof text language sql stable
      as $$select null::text where false$$;
    create function public.storage_is_super_admin() returns boolean language sql stable
      as $$select false$$;
    create policy email_images_authenticated_insert on storage.objects for insert to authenticated
      with check(bucket_id='email-images' and
        ((storage.foldername(name))[1] in (select public.storage_admin_business_ids()) or public.storage_is_super_admin()));
    create policy email_images_authenticated_update on storage.objects for update to authenticated
      using(bucket_id='email-images' and
        ((storage.foldername(name))[1] in (select public.storage_admin_business_ids()) or public.storage_is_super_admin()))
      with check(bucket_id='email-images' and
        ((storage.foldername(name))[1] in (select public.storage_admin_business_ids()) or public.storage_is_super_admin()));
    create policy email_images_authenticated_delete on storage.objects for delete to authenticated
      using(bucket_id='email-images' and
        ((storage.foldername(name))[1] in (select public.storage_admin_business_ids()) or public.storage_is_super_admin()));
    create policy marketing_assets_insert on storage.objects for insert to authenticated
      with check(bucket_id='marketing-assets' and
        ((storage.foldername(name))[1] in (select public.storage_admin_business_ids()) or public.storage_is_super_admin()));
    create policy marketing_assets_delete on storage.objects for delete to authenticated
      using(bucket_id='marketing-assets' and
        ((storage.foldername(name))[1] in (select public.storage_admin_business_ids()) or public.storage_is_super_admin()));
    create policy trip_photos_upload on storage.objects for insert to authenticated
      with check(bucket_id='trip-photos');
    insert into storage.buckets values('onboarding-assets',true,5242880,
      array['image/jpeg','image/png','image/webp','image/svg+xml']);
    create table public.businesses(id uuid primary key, yoco_secret_key_encrypted text);
    create table public.tours(id uuid, business_id uuid, unique(id,business_id));
    create table public.slots(id uuid, business_id uuid, tour_id uuid, unique(id,business_id), unique(id,business_id,tour_id),
      foreign key(tour_id,business_id) references public.tours(id,business_id));
    create table public.customers(id uuid, business_id uuid, unique(id,business_id));
    create table public.bookings(id uuid, business_id uuid, tour_id uuid, slot_id uuid, customer_id uuid, unique(id,business_id),
      foreign key(tour_id,business_id) references public.tours(id,business_id),
      foreign key(slot_id,business_id,tour_id) references public.slots(id,business_id,tour_id),
      foreign key(customer_id,business_id) references public.customers(id,business_id));
    create table public.holds(id uuid, business_id uuid, booking_id uuid, slot_id uuid,
      foreign key(booking_id,business_id) references public.bookings(id,business_id),
      foreign key(slot_id,business_id) references public.slots(id,business_id));
    create table public.marketing_templates(id uuid, business_id uuid, unique(id,business_id));
    create table public.marketing_contacts(id uuid, business_id uuid, unique(id,business_id));
    create table public.marketing_campaigns(id uuid, business_id uuid, template_id uuid, unique(id,business_id),
      foreign key(template_id,business_id) references public.marketing_templates(id,business_id));
    create table public.marketing_queue(id uuid, business_id uuid, campaign_id uuid, contact_id uuid,
      foreign key(campaign_id,business_id) references public.marketing_campaigns(id,business_id),
      foreign key(contact_id,business_id) references public.marketing_contacts(id,business_id));
    create table public.marketing_automations(id uuid, business_id uuid, unique(id,business_id));
    create table public.marketing_automation_steps(id uuid, business_id uuid, automation_id uuid, template_id uuid,
      foreign key(automation_id,business_id) references public.marketing_automations(id,business_id),
      foreign key(template_id,business_id) references public.marketing_templates(id,business_id));
    create table public.secrets(id int, value text);
    create table public.reviews(id int, booking_id uuid);
    create function public.get_business_credentials() returns int language sql security definer
      set search_path=public,pg_temp as $$select 1$$;
    revoke all on function public.get_business_credentials() from public;
    grant usage on schema public to authenticated;
    grant select on public.bookings to authenticated;
    alter table public.bookings enable row level security;
    create policy booking_tenant on public.bookings for select to authenticated
      using(business_id::text=current_setting('fixture.tenant',true));
    insert into public.tours values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011'),
      ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000022');
    insert into public.bookings(id,business_id,tour_id) values
      ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000002');
  `);
  const baseline = { grants: [{ grantee: 'authenticated', table_name: 'bookings', privilege_type: 'SELECT' }] };
  assert.deepEqual(await auditAdditionalSecurity(admin, baseline), []);
  await admin.query('begin');
  try {
    await admin.query('set local role authenticated');
    await admin.query("select set_config('fixture.tenant','00000000-0000-0000-0000-000000000011',true)");
    const result = await admin.query('select id from public.bookings order by id');
    assert.deepEqual(result.rows.map(r => r.id), ['00000000-0000-0000-0000-000000000101']);
    await assert.rejects(admin.query('select value from public.secrets'), { code: '42501' });
  } finally { await admin.query('rollback'); }
  console.log('PASS authenticated own-tenant read, foreign row and secrets denied');
  await findingAfter('grant select on public.secrets to public', 'PUBLIC SELECT on public.secrets');
  await findingAfter('create role c05_reader nologin; grant c05_reader to authenticated; grant select on public.secrets to c05_reader', 'Unexpected effective authenticated SELECT on public.secrets');
  await findingAfter('grant update(yoco_secret_key_encrypted) on public.businesses to authenticated', 'Authenticated can update protected public.businesses.yoco_secret_key_encrypted');
  await findingAfter('grant select(value) on public.secrets to public', 'PUBLIC SELECT on public.secrets.value');
  await findingAfter('grant select(booking_id) on public.reviews to anon', 'Unreviewed column anon SELECT on public.reviews.booking_id');
  await findingAfter('grant execute on function public.get_business_credentials() to public', 'Client EXECUTE on service-only public.get_business_credentials()');
  await findingAfter('create function public.unsafe_path() returns int language sql security definer set search_path=public as $$select 1$$', 'Unconstrained search_path on SECURITY DEFINER public.unsafe_path()');
  await admin.query('begin');
  try {
    await admin.query("create function public.empty_path() returns int language sql security definer set search_path='' as $$select 1$$");
    assert.deepEqual(await auditAdditionalSecurity(admin, baseline), []);
  } finally { await admin.query('rollback'); }
  console.log('PASS explicit empty SECURITY DEFINER search_path');
  await findingAfter('create view public.private_view as select * from public.secrets; grant select on public.private_view to authenticated', 'Client-readable owner-rights view public.private_view');
  await findingAfter('alter table public.bookings drop constraint bookings_customer_id_business_id_fkey', 'Missing validated tenant FK bookings(customer_id,business_id)');
  await findingAfter('alter table storage.objects disable row level security', 'storage.objects RLS disabled');
  await findingAfter('drop policy "Anon upload of onboarding assets" on storage.objects', 'Storage write policy missing Anon upload of onboarding assets');
  await findingAfter(`drop policy "Anon upload of onboarding assets" on storage.objects;
    create policy "Anon upload of onboarding assets" on storage.objects for insert to anon
      with check(bucket_id='onboarding-assets' or true)`, 'Storage write policy changed Anon upload of onboarding assets');
  await findingAfter('create policy extra_upload on storage.objects for insert to authenticated with check(true)', 'Unreviewed client Storage write policy extra_upload');
  await admin.query('begin');
  try {
    await admin.query(`alter policy email_images_authenticated_insert on storage.objects to anon with check(true);
      grant usage on schema storage to anon; grant insert on storage.objects to anon`);
    const findings = await auditAdditionalSecurity(admin, baseline);
    assert(findings.includes('Storage write policy changed email_images_authenticated_insert'));
    await admin.query('set local role anon');
    await admin.query("insert into storage.objects values('private-other-tenant','synthetic.txt')");
  } finally { await admin.query('rollback'); }
  console.log('PASS drift: widened named Storage policy and actual anon insert');
  console.log('PASS C05 local TLS and database drift fixture');
} finally {
  if (admin) await admin.end().catch(() => {});
  if (started) run(join(pgBin, 'pg_ctl'), ['-D', join(root, 'data'), '-m', 'immediate', 'stop']);
  console.log('Local fixture stopped; evidence directory: ' + root);
}
