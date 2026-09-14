// DECOMMISSIONED 2026-08-05 — legacy pre-multi-tenant function, now a tombstone.
//
// Legacy cron entrypoint using global WhatsApp credentials.
// Replacement: cron-tasks (scheduled every 5 minutes)
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
    JSON.stringify({ error: "gone", message: "cron-jobs was decommissioned on 2026-08-05. Use: cron-tasks (scheduled every 5 minutes)" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
