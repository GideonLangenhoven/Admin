// Read-only application outcome projection. This does not emit analytics,
// change billing, or infer conversions from client clicks/current ACTIVE state.
// No .env loader, network analytics client, cookies, or customer-table queries.
import assert from 'node:assert/strict';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sources = new Set(['chatgpt','muse','google','facebook','instagram','referral']);
const media = new Set(['organic','referral','paid_social','email']);

export function acquisitionAttribution(params, { analyticsConsent, approvedCampaigns = [] }) {
  // Consent must come from the operator acquisition flow, not an AI grant or
  // the traveller's booking marketing checkbox. Only approved coarse tags.
  if (analyticsConsent !== true) return null;
  const sourceTag = params.get('utm_source');
  const source = sourceTag === 'chatgpt.com' ? 'chatgpt' : sourceTag;
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');
  return {
    source: sources.has(source) ? source : 'unknown',
    medium: media.has(medium) ? medium : null,
    campaign: approvedCampaigns.includes(campaign) && /^[a-z][a-z0-9-]{0,63}$/.test(campaign) ? campaign : null,
    basis: source && sources.has(source) ? 'campaign_tag' : 'unknown',
  };
}

const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const dateString = value => value instanceof Date ? value.toISOString() : value;
const positive = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;

export function projectOperatorOutcomes({ invoices = [], statusEvents = [] }) {
  const byKey = new Map();
  const add = event => {
    const previous = byKey.get(event.event_id);
    if (!previous || Date.parse(event.occurred_at) < Date.parse(previous.occurred_at)) byKey.set(event.event_id, event);
  };
  // Auth creation + current MAIN_ADMIN membership cannot date an operator
  // signup: legacy password migration, account reuse and role changes also
  // produce that join. Leave this milestone unavailable until a durable
  // first-successful operator-account-link event exists.
  for (const row of statusEvents) {
    const at = dateString(row.created_at);
    if (row.action_type !== 'BUSINESS_STATUS_CHANGED' || row.target_entity !== 'businesses'
      || !uuid.test(row.business_id || '') || row.target_id !== row.business_id
      || row.before_status === null || row.before_status === undefined || row.before_status === 'TRIAL'
      || row.after_status !== 'TRIAL' || !iso(at)) continue;
    add({ event: 'trial_activated', event_id: `trial_activated:${row.business_id}`,
      business_id: row.business_id, occurred_at: at, source: 'unknown', evidence: 'audited_trial_transition' });
  }
  for (const row of invoices) {
    const at = dateString(row.paid_at);
    // The source reader below reads PLATFORM invoices only. A tour's payment
    // or top-up never enters this projection. Manual marks are not captures.
    if (row.source_table !== 'platform_invoices' || row.status !== 'PAID' || row.paid_method !== 'YOCO'
      || !uuid.test(row.id || '') || !uuid.test(row.business_id || '') || !row.yoco_payment_id
      || !positive(row.monthly_price_zar) || !positive(row.amount_zar) || !iso(at)) continue;
    add({ event: 'operator_subscription_payment_confirmed', event_id: `operator_subscription_payment_confirmed:${row.id}`,
      business_id: row.business_id, occurred_at: at, source: 'unknown', evidence: 'reconciled_platform_invoice',
      payment_environment: 'unknown', live_conversion_confirmed: null });
  }
  return [...byKey.values()].sort((a,b) => Date.parse(a.occurred_at)-Date.parse(b.occurred_at) || a.event_id.localeCompare(b.event_id));
}

export async function readOperatorOutcomes(client, { businessIds, startAt, endAt }) {
  assert(Array.isArray(businessIds) && businessIds.length >= 1 && businessIds.length <= 50
    && businessIds.every(id => uuid.test(id)), 'Specify 1–50 business UUIDs');
  assert(iso(startAt) && iso(endAt) && Date.parse(endAt) > Date.parse(startAt)
    && Date.parse(endAt)-Date.parse(startAt) <= 31*86_400_000, 'Specify a range of at most 31 days');
  const args = [businessIds, startAt, endAt];
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    const invoices = await client.query(`SELECT 'platform_invoices' AS source_table, id, business_id, status,
        paid_method, paid_at, monthly_price_zar, amount_zar, (nullif(trim(yoco_payment_id),'') IS NOT NULL) AS yoco_payment_id
      FROM public.platform_invoices WHERE business_id=ANY($1::uuid[])
        AND paid_at >= $2::timestamptz AND paid_at < $3::timestamptz
      ORDER BY paid_at,id LIMIT 1001`, args);
    const statusEvents = await client.query(`SELECT business_id, created_at, action_type, target_entity,target_id,
        before_state->>'subscription_status' AS before_status,after_state->>'subscription_status' AS after_status
      FROM public.audit_logs WHERE business_id=ANY($1::uuid[]) AND action_type='BUSINESS_STATUS_CHANGED'
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
      ORDER BY created_at,id LIMIT 1001`, args);
    assert([invoices,statusEvents].every(result => result.rows.length <= 1000), 'Query limit reached; narrow the range');
    return {
      events: projectOperatorOutcomes({ invoices: invoices.rows, statusEvents: statusEvents.rows }),
      coverage: {
        demo_click: 'website_event_required', lead_submitted: 'accepted_lead_event_required',
        operator_account_created: 'unavailable; immutable_first_operator_account_link_event_required',
        trial_activated: 'only_explicit_audited_transition; current_status_is_insufficient',
        operator_subscription_payment_confirmed: 'reconciled_yoco_platform_invoice_only',
        live_conversion_confirmed: 'unavailable; invoice_rows_do_not_establish_test_or_live_provider_environment',
        attribution: 'unknown_until_consented_cross_repository_join_exists',
      },
    };
  } finally { await client.query('ROLLBACK'); }
}
