// DECOMMISSIONED 2026-08-05 — legacy pre-multi-tenant function, now a tombstone.
//
// Legacy hold-expiry sweep using global WhatsApp credentials.
// Replacement: the expire-holds-db SQL cron (every minute) plus cron-tasks
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
    JSON.stringify({ error: "gone", message: "hold-expiry was decommissioned on 2026-08-05. Use: the expire-holds-db SQL cron (every minute) plus cron-tasks" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
