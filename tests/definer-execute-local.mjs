import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Section 5 regression. Synthetic data only. Refuse remote hosts and never load application secrets.
// Usage: node tests/definer-execute-local.mjs <disposable socket dir> <port>
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), database: 'postgres', user: process.env.USER });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUPER = id(1), ADMIN_A = id(2), CUSTOMER = id(3), A = id(11), B = id(12), PROMO_B = id(21), AUTO_B = id(22), PROMO_A = id(23);

async function as(role, user, work) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [user || '', role]);
  await db.query(`SET LOCAL ROLE ${role}`);
  try { return await work(); } finally { await db.query('RESET ROLE'); }
}
async function refused(sql, params) {
  await db.query('SAVEPOINT refused');
  try { await db.query(sql, params); } catch (error) { await db.query('ROLLBACK TO SAVEPOINT refused'); return error.message; }
  assert.fail('expected refusal: ' + sql);
}
const can = async (role, fn) => (await db.query('SELECT has_function_privilege($1, $2::regprocedure, \'EXECUTE\') ok', [role, fn])).rows[0].ok;
const one = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];

// Production signatures (27 Oct).
const SERVICE_ONLY = ['bt_record_otp_failed_attempt(text, integer, integer)', 'calculate_refund_percent(uuid, timestamptz, timestamptz)',
  'cleanup_old_idempotency_keys()', 'cleanup_stale_webchat_sessions()', 'create_hold_with_capacity_check(uuid, uuid, integer, timestamptz)',
  'deduct_voucher_balance(uuid, numeric)', 'increment_campaign_counter(uuid, text, integer)', 'increment_contact_counter(uuid, text, integer)',
  'increment_marketing_email_usage(uuid, integer)', 'list_all_businesses()', 'next_invoice_number()', 'recompute_customer_stats(uuid)',
  'reset_stale_wa_conversations()', 'resolve_business_by_subdomain(text)', 'set_business_admin_seats(uuid, integer)', 'set_business_email_rate(uuid, numeric)'];
const SIGNED_IN = ['apply_promo_code(uuid, text, uuid, text)', 'increment_automation_counter(uuid, text, integer)', 'link_customer_user()',
  'next_invoice_number(uuid)', 'storage_admin_business_ids()', 'storage_is_super_admin()'];
const TRIGGERS = ['_audit_admin_users_changes', '_audit_businesses_changes', 'block_read_only_admin_write', 'ck_sync_marketing_contact',
  'protect_platform_business_fields', 'set_hold_business', 'strip_anon_booking_money', 'zero_anon_booking_money'];
const ANON_KEPT = ['current_business_ids()', 'sign_waiver(uuid, uuid, text, jsonb)', 'validate_promo_code(uuid, text, numeric, text)'];
const PINNED = ['public.advance_arrival_approval_version()', 'public.guard_arrival_approval_history()', 'public.is_inside_business_hours(uuid)',
  'public.match_kb_chunks(uuid, extensions.vector, integer, double precision)', 'public.match_admin_kb_chunks(text, extensions.vector, integer, double precision)',
  'app_private.validate_business_config()'];

await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA app_private;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    GRANT USAGE ON SCHEMA auth, extensions, app_private TO anon, authenticated, service_role;
    CREATE DOMAIN extensions.vector AS float8[];
    CREATE TABLE businesses(id uuid PRIMARY KEY);
    CREATE TABLE admin_users(user_id uuid, business_id uuid, role text, suspended boolean DEFAULT false);
    CREATE TABLE promotions(id uuid PRIMARY KEY, business_id uuid, max_uses integer, used_count integer DEFAULT 0, active boolean DEFAULT true, valid_until timestamptz);
    CREATE TABLE promotion_uses(id uuid PRIMARY KEY, promotion_id uuid, email text, booking_id uuid, used_at timestamptz, UNIQUE (promotion_id, email));
    CREATE TABLE marketing_automations(id uuid PRIMARY KEY, business_id uuid, enrolled_count integer, completed_count integer);
    CREATE TABLE tenant_invoice_sequences(business_id uuid PRIMARY KEY, last_number integer NOT NULL);
    CREATE TABLE holds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
    GRANT SELECT, INSERT ON holds TO anon;
    -- As live.
    CREATE FUNCTION public.current_business_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      with me as (
        select business_id, role from public.admin_users
        where user_id = auth.uid() and not coalesce(suspended, false)
          and role in ('OPERATOR', 'ADMIN', 'MAIN_ADMIN', 'SUPER_ADMIN')
      )
      select case when exists (select 1 from me where role = 'SUPER_ADMIN')
        then coalesce((select array_agg(id) from public.businesses), '{}'::uuid[])
        else coalesce((select array_agg(distinct business_id) from me where business_id is not null), '{}'::uuid[])
      end $$;
    -- The live body before this change: any caller, any business.
    CREATE FUNCTION public.next_invoice_number(p_business_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE next_val integer;
    BEGIN
      INSERT INTO public.tenant_invoice_sequences (business_id, last_number) VALUES (p_business_id, 0) ON CONFLICT (business_id) DO NOTHING;
      UPDATE public.tenant_invoice_sequences SET last_number = last_number + 1 WHERE business_id = p_business_id RETURNING last_number INTO next_val;
      RETURN 'INV-' || LPAD(next_val::text, 5, '0');
    END $$;
    CREATE FUNCTION public.set_hold_business() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NEW.business_id := '${A}'; RETURN NEW; END $$;
    CREATE TRIGGER set_hold_business BEFORE INSERT ON holds FOR EACH ROW EXECUTE FUNCTION public.set_hold_business();
    CREATE FUNCTION app_private.validate_business_config() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    INSERT INTO businesses VALUES ('${A}'), ('${B}');
    INSERT INTO admin_users VALUES ('${SUPER}', NULL, 'SUPER_ADMIN'), ('${ADMIN_A}', '${A}', 'MAIN_ADMIN');
    INSERT INTO promotions(id, business_id) VALUES ('${PROMO_B}', '${B}'), ('${PROMO_A}', '${A}');
    INSERT INTO marketing_automations VALUES ('${AUTO_B}', '${B}', 0, 0);`);
  // Stubs with the live signatures for everything else the migration names.
  for (const sig of [...SERVICE_ONLY, ...SIGNED_IN, ...ANON_KEPT, ...PINNED.filter(s => s.startsWith('public.')).map(s => s.slice(7))]) {
    const exists = await one("SELECT count(*)::int FROM pg_proc WHERE oid = to_regprocedure('public.' || $1)", [sig]);
    const ret = sig.startsWith('apply_promo_code') ? 'jsonb' : 'void'; // the migration replaces it, keeping its return type
    if (!exists) await db.query(`CREATE FUNCTION public.${sig} RETURNS ${ret} LANGUAGE sql SECURITY DEFINER AS 'SELECT NULL::${ret === 'void' ? 'text' : ret}'`);
  }
  for (const name of TRIGGERS.filter(n => n !== 'set_hold_business')) {
    await db.query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$`);
  }
  // Supabase's default privileges: every function is executable by all three API roles.
  await db.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role');

  // Before: anon can inflate a tenant's email usage, and tenant A's admin can
  // advance tenant B's invoice numbers.
  assert.equal(await can('anon', 'increment_marketing_email_usage(uuid, integer)'), true);
  assert.equal(await as('authenticated', ADMIN_A, () => one('SELECT next_invoice_number($1)', [B])), 'INV-00001');

  await db.query(readFileSync('supabase/migrations/20261027180000_definer_execute_hardening.sql', 'utf8'));

  for (const fn of SERVICE_ONLY) {
    assert.deepEqual([fn, await can('anon', fn), await can('authenticated', fn), await can('service_role', fn)], [fn, false, false, true]);
  }
  for (const fn of SIGNED_IN) {
    assert.deepEqual([fn, await can('anon', fn), await can('authenticated', fn), await can('service_role', fn)], [fn, false, true, true]);
  }
  for (const name of TRIGGERS) {
    assert.deepEqual([name, await can('anon', name + '()'), await can('authenticated', name + '()')], [name, false, false]);
  }
  for (const fn of ANON_KEPT) assert.equal(await can('anon', fn), true, fn);
  for (const fn of PINNED) {
    assert.deepEqual(await one('SELECT proconfig FROM pg_proc WHERE oid = $1::regprocedure', [fn]), ['search_path=public, extensions, pg_temp'], fn);
  }

  // Triggers still fire for anon without EXECUTE on the trigger function.
  assert.equal(await as('anon', null, () => one('INSERT INTO holds DEFAULT VALUES RETURNING business_id')), A);

  // Invoice numbers: own business, super-admin, service_role; never another business, a customer or no business.
  assert.equal(await as('authenticated', ADMIN_A, () => one('SELECT next_invoice_number($1)', [A])), 'INV-00001');
  assert.match(await as('authenticated', ADMIN_A, () => refused('SELECT next_invoice_number($1)', [B])), /Not allowed for this business/);
  assert.match(await as('authenticated', CUSTOMER, () => refused('SELECT next_invoice_number($1)', [A])), /Not allowed for this business/);
  assert.match(await as('authenticated', ADMIN_A, () => refused('SELECT next_invoice_number(NULL)')), /Not allowed for this business/);
  assert.equal(await as('authenticated', SUPER, () => one('SELECT next_invoice_number($1)', [B])), 'INV-00002');
  assert.equal(await as('service_role', null, () => one('SELECT next_invoice_number($1)', [B])), 'INV-00003');

  // Promo uses: another business's promo reads as not found and isn't consumed.
  assert.deepEqual(await as('authenticated', ADMIN_A, () => one("SELECT apply_promo_code($1, 'guest@example.invalid')", [PROMO_B])), { ok: false, error: 'promo not found' });
  assert.equal(await one('SELECT used_count FROM promotions WHERE id = $1', [PROMO_B]), 0);
  assert.deepEqual(await as('authenticated', ADMIN_A, () => one("SELECT apply_promo_code($1, 'guest@example.invalid')", [PROMO_A])), { ok: true, used_count: 1 });
  assert.deepEqual(await as('service_role', null, () => one("SELECT apply_promo_code($1, 'guest@example.invalid')", [PROMO_B])), { ok: true, used_count: 1 });

  // Automation counters: another business's automation is left alone.
  await as('authenticated', ADMIN_A, () => db.query("SELECT increment_automation_counter($1, 'enrolled_count')", [AUTO_B]));
  assert.equal(await one('SELECT enrolled_count FROM marketing_automations WHERE id = $1', [AUTO_B]), 0);
  await as('authenticated', SUPER, () => db.query("SELECT increment_automation_counter($1, 'enrolled_count')", [AUTO_B]));
  await as('service_role', null, () => db.query("SELECT increment_automation_counter($1, 'enrolled_count', 2)", [AUTO_B]));
  assert.equal(await one('SELECT enrolled_count FROM marketing_automations WHERE id = $1', [AUTO_B]), 3);

  console.log('definer execute hardening: all checks passed');
} finally {
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
}
