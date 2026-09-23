// Additional fail-closed checks grounded in ROLE_MATRIX.md and the September
// tenant, sensitive-settings, demo, and Storage migrations. The older baseline
// remains untouched until an independently reviewed deployed snapshot exists.

const roles = ["anon", "authenticated", "service_role"];
const tablePrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const columnPrivileges = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const allowedColumnGrants = new Set([
  "anon|businesses|SELECT",       // public storefront fields, with explicit sensitive exclusions
  "authenticated|businesses|UPDATE", // ordinary settings only
]);
const publicReviewColumns = new Set([
  "id", "business_id", "tour_id", "source", "status", "rating", "comment",
  "reviewer_name", "reviewer_avatar_url", "submitted_at", "created_at",
]);
const secretBusinessColumns = new Set([
  "operator_email", "notification_email", "marketing_test_email",
  "wa_token_encrypted", "wa_phone_id_encrypted", "wa_phone_id_lookup",
  "yoco_secret_key_encrypted", "yoco_webhook_secret_encrypted",
  "yoco_test_secret_key_encrypted", "yoco_test_webhook_secret_encrypted",
  "yoco_test_mode", "yoco_webhook_status", "paysafe_api_key_encrypted",
  "paysafe_api_secret_encrypted", "google_drive_refresh_token_encrypted",
  "bank_account_owner_encrypted", "bank_account_number_encrypted",
  "bank_account_type_encrypted", "bank_name_encrypted", "bank_branch_code_encrypted",
  "paysafe_account_id", "paysafe_linked_account_id", "google_drive_folder_id",
  "google_drive_email", "gdrive_photos_folder_id", "gdrive_photos_folder_url",
  "max_admin_seats", "marketing_email_usage", "marketing_included_emails",
  "marketing_overage_rate_zar", "automation_config", "whatsapp_bot_mode",
  "whatsapp_bot_mode_changed_at", "whatsapp_bot_mode_changed_by",
]);
const protectedBusinessUpdates = new Set([
  "bank_account_owner_encrypted", "bank_account_number_encrypted",
  "bank_account_type_encrypted", "bank_name_encrypted", "bank_branch_code_encrypted",
  "wa_token_encrypted", "wa_phone_id_encrypted", "wa_phone_id_lookup",
  "yoco_secret_key_encrypted", "yoco_webhook_secret_encrypted",
  "yoco_test_secret_key_encrypted", "yoco_test_webhook_secret_encrypted",
  "yoco_test_mode", "yoco_webhook_status",
]);
const serviceOnlyFunctions = new Set([
  "confirm_combo_payment_atomic", "get_business_credentials", "set_yoco_test_credentials",
  "upsert_customer", "increment_marketing_monthly_usage", "claim_marketing_queue",
  "claim_marketing_automation_enrollments", "claim_notification_jobs", "finish_notification_job",
  "validate_notification_job", "enqueue_voucher_payment_reminder",
  "enqueue_voucher_payment_reminders", "retry_notification_job", "cleanup_abandoned_voucher",
  "expire_single_hold", "assert_sensitive_settings_actor", "set_sensitive_credentials_audited",
  "set_business_bank_details_audited", "set_platform_bank_details_audited",
  "begin_mfa_recovery", "finish_mfa_recovery", "set_marketing_step_business",
  "clear_deleted_marketing_step_template",
  "r13_capture_report", "reserve_refund_request", "finish_refund_operation",
  "claim_yoco_payment", "finish_yoco_payment", "reserve_voucher_amount",
  "settle_voucher_reservations", "release_voucher_reservations",
  "confirm_booking_payment", "purge_operational_logs", "prepare_booking_checkout",
  "confirm_voucher_booking", "cancel_booking_transaction", "prepare_booking_amendment",
  "confirm_booking_uplift", "apply_booking_change", "account_manual_booking",
  "save_checkout_request", "record_unfulfilled_payment", "record_booking_arrival",
  "issue_admin_setup_token", "claim_admin_setup_token", "complete_admin_setup_token",
  "release_admin_setup_token_claim", "cancel_voucher_notification_jobs",
  "cancel_booking_notification_jobs", "enqueue_replacement_booking_notification_job",
  "refresh_claires_hiking_demo_dates", "sync_booking_arrival_state", "audit_direct_booking_arrival",
]);
// pg_policies' rendered expressions for the reviewed Storage write migrations.
// Normalization below ignores formatting and an optional public. qualification,
// but retains every operator and term (including any added OR true).
const bucketOnly = bucket => `(bucket_id = '${bucket}'::text)`;
const tenantFolder = bucket => `((bucket_id = '${bucket}'::text) AND (((storage.foldername(name))[1] IN ( SELECT storage_admin_business_ids() AS storage_admin_business_ids)) OR storage_is_super_admin()))`;
const storageWritePolicies = new Map([
  ['Anon upload of onboarding assets', ['INSERT', 'anon', null, bucketOnly('onboarding-assets')]],
  ['email_images_authenticated_insert', ['INSERT', 'authenticated', null, tenantFolder('email-images')]],
  ['email_images_authenticated_update', ['UPDATE', 'authenticated', tenantFolder('email-images'), tenantFolder('email-images')]],
  ['email_images_authenticated_delete', ['DELETE', 'authenticated', tenantFolder('email-images'), null]],
  ['marketing_assets_insert', ['INSERT', 'authenticated', null, tenantFolder('marketing-assets')]],
  ['marketing_assets_delete', ['DELETE', 'authenticated', tenantFolder('marketing-assets'), null]],
  ['trip_photos_upload', ['INSERT', 'authenticated', null, bucketOnly('trip-photos')]],
]);
const normalizedPolicy = expression => expression?.replaceAll('public.', '').replaceAll(/\s+/g, '') ?? null;
const tenantLinks = [
  ["slots", "tour_id,business_id", "tours", "id,business_id"],
  ["bookings", "tour_id,business_id", "tours", "id,business_id"],
  ["bookings", "slot_id,business_id,tour_id", "slots", "id,business_id,tour_id"],
  ["bookings", "customer_id,business_id", "customers", "id,business_id"],
  ["holds", "booking_id,business_id", "bookings", "id,business_id"],
  ["holds", "slot_id,business_id", "slots", "id,business_id"],
  ["marketing_campaigns", "template_id,business_id", "marketing_templates", "id,business_id"],
  ["marketing_queue", "campaign_id,business_id", "marketing_campaigns", "id,business_id"],
  ["marketing_queue", "contact_id,business_id", "marketing_contacts", "id,business_id"],
  ["marketing_automation_steps", "automation_id,business_id", "marketing_automations", "id,business_id"],
  ["marketing_automation_steps", "template_id,business_id", "marketing_templates", "id,business_id"],
];

const tableSql = `
  select r.rolname role, c.relname relation, v.privilege,
    has_table_privilege(r.oid, c.oid, v.privilege) effective
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join pg_roles r
  cross join (values ${tablePrivileges.map(x => `('${x}')`).join(",")}) v(privilege)
  where n.nspname='public' and c.relkind in ('r','p','v','m','f')
    and r.rolname=any($1::text[])
  order by role, relation, privilege`;
const columnSql = `
  select r.rolname role, c.relname relation, a.attname column_name, v.privilege,
    has_column_privilege(r.oid,c.oid,a.attname,v.privilege) effective,
    has_table_privilege(r.oid,c.oid,v.privilege) table_effective,
    exists(select 1 from aclexplode(a.attacl) acl
      where acl.grantee=0 and acl.privilege_type=v.privilege) public_grant
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  cross join pg_roles r
  cross join (values ${columnPrivileges.map(x => `('${x}')`).join(",")}) v(privilege)
  where n.nspname='public' and c.relkind in ('r','p','v','m','f')
    and r.rolname=any($1::text[])
    and (a.attacl is not null or
      (c.relname='businesses' and a.attname=any($2::text[])))
  order by role, relation, column_name, privilege`;
const publicTableSql = `
  select c.relname relation, acl.privilege_type privilege
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(c.relacl) acl
  where n.nspname='public' and c.relkind in ('r','p','v','m','f') and acl.grantee=0`;
const functionSql = `
  select p.proname name, pg_get_function_identity_arguments(p.oid) args,
    owner.rolname owner, p.prosecdef definer, p.proconfig settings,
    pg_has_role('anon',owner.oid,'MEMBER') or pg_has_role('authenticated',owner.oid,'MEMBER') client_owner,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join pg_roles owner on owner.oid=p.proowner
  where n.nspname='public' and p.prokind='f'`;
const viewSql = `
  select c.relname name, c.reloptions,
    has_table_privilege('anon',c.oid,'SELECT') anon_select,
    has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('v','m')`;
const linkSql = `
  select child.relname child, parent.relname parent, con.convalidated valid,
    (select string_agg(a.attname,',' order by k.ord)
      from unnest(con.conkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=child.oid and a.attnum=k.attnum) child_columns,
    (select string_agg(a.attname,',' order by k.ord)
      from unnest(con.confkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=parent.oid and a.attnum=k.attnum) parent_columns
  from pg_constraint con
  join pg_class child on child.oid=con.conrelid
  join pg_class parent on parent.oid=con.confrelid
  join pg_namespace ns on ns.oid=child.relnamespace
  where con.contype='f' and ns.nspname='public'`;

export async function auditAdditionalSecurity(client, baseline) {
  const findings = [];
  const expected = new Set(baseline.grants.map(g => `${g.grantee}|${g.table_name}|${g.privilege_type}`));
  const tables = await client.query(tableSql, [roles]);
  const columns = await client.query(columnSql, [roles, [...new Set([...secretBusinessColumns, ...protectedBusinessUpdates])]]);
  const publicTables = await client.query(publicTableSql);
  const functions = await client.query(functionSql);
  const views = await client.query(viewSql);
  const links = await client.query(linkSql);
  const schemas = await client.query(`select nspname schema, has_schema_privilege('anon',oid,'CREATE') anon_create,
      has_schema_privilege('authenticated',oid,'CREATE') authenticated_create,
      exists(select 1 from aclexplode(nspacl) acl where acl.grantee=0 and acl.privilege_type='CREATE') public_create
      from pg_namespace where nspname in ('public','auth','storage','extensions')`);
  const temporary = await client.query(`select has_database_privilege('anon',current_database(),'TEMPORARY') anon_temp,
    has_database_privilege('authenticated',current_database(),'TEMPORARY') authenticated_temp`);
  for (const row of tables.rows) {
    if (row.effective && !expected.has(`${row.role}|${row.relation}|${row.privilege}`)) {
      findings.push(`Unexpected effective ${row.role} ${row.privilege} on public.${row.relation}`);
    }
  }
  for (const row of publicTables.rows) {
    findings.push(`PUBLIC ${row.privilege} on public.${row.relation}`);
  }
  for (const row of columns.rows) {
    if (row.public_grant) findings.push(`PUBLIC ${row.privilege} on public.${row.relation}.${row.column_name}`);
    if (!row.effective) continue;
    if (row.role === 'anon' && row.relation === 'businesses' && row.privilege === 'SELECT' && secretBusinessColumns.has(row.column_name)) {
      findings.push(`Anon can read protected public.businesses.${row.column_name}`);
    }
    if (row.role === 'authenticated' && row.relation === 'businesses' && row.privilege === 'UPDATE' && protectedBusinessUpdates.has(row.column_name)) {
      findings.push(`Authenticated can update protected public.businesses.${row.column_name}`);
    }
    const publicReview = row.role === 'anon' && row.relation === 'reviews' &&
      row.privilege === 'SELECT' && publicReviewColumns.has(row.column_name);
    if (!row.table_effective && !publicReview && !allowedColumnGrants.has(`${row.role}|${row.relation}|${row.privilege}`)) {
      findings.push(`Unreviewed column ${row.role} ${row.privilege} on public.${row.relation}.${row.column_name}`);
    }
  }
  const writableSchemas = new Set(schemas.rows.filter(s => s.anon_create || s.authenticated_create || s.public_create).map(s => s.schema));
  for (const schema of writableSchemas) findings.push(`Untrusted CREATE on ${schema} schema`);
  for (const row of functions.rows) {
    const signature = `public.${row.name}(${row.args})`;
    if ((serviceOnlyFunctions.has(row.name) || row.name.startsWith('platform_')) && (row.anon_execute || row.authenticated_execute)) {
      findings.push(`Client EXECUTE on service-only ${signature}`);
    }
    if (!row.definer) continue;
    if (roles.includes(row.owner) || row.client_owner) findings.push(`Untrusted owner of SECURITY DEFINER ${signature}`);
    const configuredPath = row.settings?.find(setting => setting.startsWith('search_path='))?.slice('search_path='.length);
    const path = configuredPath === '""' ? '' : configuredPath;
    const parts = path === '' ? [] : path?.split(',').map(x => x.trim().replace(/^"|"$/g, '')) ?? [];
    if (path === undefined || parts.some(x => !['pg_catalog','public','auth','storage','extensions','pg_temp'].includes(x)) ||
        (path !== '' && (temporary.rows[0].anon_temp || temporary.rows[0].authenticated_temp) && !parts.includes('pg_temp')) ||
        (parts.includes('pg_temp') && parts.at(-1) !== 'pg_temp') ||
        parts.some(x => writableSchemas.has(x))) {
      findings.push(`Unconstrained search_path on SECURITY DEFINER ${signature}`);
    }
  }
  for (const row of views.rows) {
    if ((row.anon_select || row.authenticated_select) &&
        !row.reloptions?.includes('security_invoker=true')) {
      findings.push(`Client-readable owner-rights view public.${row.name}`);
    }
  }
  const actualLinks = new Set(links.rows.filter(x => x.valid).map(x => `${x.child}|${x.child_columns}|${x.parent}|${x.parent_columns}`));
  for (const link of tenantLinks) {
    if (!actualLinks.has(link.join('|'))) findings.push(`Missing validated tenant FK ${link[0]}(${link[1]}) -> ${link[2]}(${link[3]})`);
  }
  const storage = await client.query(`
    select to_regclass('storage.objects') is not null objects_present,
      to_regclass('storage.buckets') is not null buckets_present`);
  if (!storage.rows[0].objects_present || !storage.rows[0].buckets_present) {
    findings.push('Storage security tables unavailable');
  } else {
    const objects = await client.query(`select c.relrowsecurity rls,
        exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='block_read_only_admin_write' and t.tgenabled='O') demo_guard
        from pg_class c where c.oid='storage.objects'::regclass`);
    const policies = await client.query(`select policyname, cmd, roles::text[] roles, qual, with_check from pg_policies
        where schemaname='storage' and tablename='objects'`);
    const buckets = await client.query(`select id, public, file_size_limit, allowed_mime_types
        from storage.buckets where id='onboarding-assets'`);
    if (!objects.rows[0]?.rls) findings.push('storage.objects RLS disabled');
    if (!objects.rows[0]?.demo_guard) findings.push('storage.objects read-only demo write guard missing');
    const seenWritePolicies = new Set();
    for (const p of policies.rows) {
      if (['INSERT','UPDATE','DELETE','ALL'].includes(p.cmd) && p.roles.includes('public')) {
        findings.push(`PUBLIC Storage write policy ${p.policyname}`);
      }
      if (['INSERT','UPDATE','DELETE','ALL'].includes(p.cmd) &&
          p.roles.some(role => role === 'anon' || role === 'authenticated') &&
          !storageWritePolicies.has(p.policyname)) {
        findings.push(`Unreviewed client Storage write policy ${p.policyname}`);
      }
      const approved = storageWritePolicies.get(p.policyname);
      if (!approved) continue;
      seenWritePolicies.add(p.policyname);
      if (p.cmd !== approved[0] || p.roles.length !== 1 || p.roles[0] !== approved[1] ||
          normalizedPolicy(p.qual) !== normalizedPolicy(approved[2]) ||
          normalizedPolicy(p.with_check) !== normalizedPolicy(approved[3])) {
        findings.push(`Storage write policy changed ${p.policyname}`);
      }
    }
    for (const name of storageWritePolicies.keys()) {
      if (!seenWritePolicies.has(name)) findings.push(`Storage write policy missing ${name}`);
    }
    const bucket = buckets.rows[0];
    if (!bucket || !bucket.public || !bucket.file_size_limit || Number(bucket.file_size_limit) > 5242880 ||
        !bucket.allowed_mime_types?.length ||
        !bucket.allowed_mime_types.every(x => ['image/jpeg','image/png','image/webp','image/svg+xml'].includes(x))) {
      findings.push('Onboarding Storage bucket bounds changed');
    }
  }
  return [...new Set(findings)].sort();
}
