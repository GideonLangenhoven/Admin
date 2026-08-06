// DECOMMISSIONED 2026-08-05 — legacy pre-multi-tenant function, now a tombstone.
//
// Legacy PayFast ITN handler using global WhatsApp credentials. PayFast was never used in production: 0 of 174 bookings carry a payfast_m_payment_id.
// Replacement: Yoco (yoco-webhook) and Paysafe (paysafe-webhook)
//
// Verified dead before locking: no reference anywhere in the repo, and no
// cron.job invokes it (the live schedule is cron-tasks, marketing-*,
// auto-messages, ota/viator/gyg sync, kb-sync, billing-enforcement,
// fetch-google-reviews, expire-holds-db).
//
// The body is gone rather than gated so there is nothing left to
// mis-authorize. Delete the deployment itself when a token with owner
// privileges is available (CLI delete returns 403 on the current token).
// Original source: git tag deploy-2026-08-05-5.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", message: "payfast-itn was decommissioned on 2026-08-05. Use: Yoco (yoco-webhook) and Paysafe (paysafe-webhook)" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
