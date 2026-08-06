// DECOMMISSIONED 2026-08-06 — legacy pre-multi-tenant function, now a tombstone.
//
// Sent a hardcoded WhatsApp trip reminder that named ONE operator's meeting
// point ("Three Anchor Bay, Beach Road, Sea Point"), assumed the activity was
// paddling, and listed a kayak-specific packing list. On a multi-tenant
// platform that would send another operator's address to a customer.
// Replacement: cron-tasks and auto-messages, which read each tenant's own
// meeting point, arrival instructions and what-to-bring.
//
// Verified dead before locking: its cron job was deleted in migration
// 20260502160000_delete_legacy_cron_jobs.sql (jobid 7, queue-reminders), no
// cron.job invokes it today, and nothing in either repo references it.
//
// Original source: git tag deploy-2026-08-06-1.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", message: "reminder-scheduler was decommissioned on 2026-08-06. Use: cron-tasks / auto-messages" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
