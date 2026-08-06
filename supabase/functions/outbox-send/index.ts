// DECOMMISSIONED 2026-08-05 — legacy pre-multi-tenant function, now a tombstone.
//
// Legacy outbox drain using global WhatsApp credentials.
// Replacement: the outbox drain inside wa-webhook, which fires on the customer's next inbound message
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
    JSON.stringify({ error: "gone", message: "outbox-send was decommissioned on 2026-08-05. Use: the outbox drain inside wa-webhook, which fires on the customer's next inbound message" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
