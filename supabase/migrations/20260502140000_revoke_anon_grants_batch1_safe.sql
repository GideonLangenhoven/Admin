-- Prompt 17: Revoke unjustified anon grants on 11 high-sensitivity tables.
-- Tier A: full revokes on 10 tables with zero anon RLS policies.
-- RLS is the only protection today; this adds grant-layer defense-in-depth.
-- Most of these revocations were already applied out-of-band; this migration
-- formalises them in the migration history for reproducibility.

-- Full revokes (idempotent — revoking non-existent grants is a no-op)
REVOKE ALL ON public.admin_users         FROM anon;
REVOKE ALL ON public.invite_tokens       FROM anon;
REVOKE ALL ON public.idempotency_keys    FROM anon;
REVOKE ALL ON public.billing_line_items  FROM anon;
REVOKE ALL ON public.invoices            FROM anon;
REVOKE ALL ON public.subscriptions       FROM anon;
REVOKE ALL ON public.ngt_payments        FROM anon;
REVOKE ALL ON public.chat_messages       FROM anon;
REVOKE ALL ON public.conversations       FROM anon;
REVOKE ALL ON public.messages            FROM anon;

-- businesses: partial revoke. Keep the column-level SELECT grants from Prompt 10.
-- Drop the broad table-level write grants and defensive N/A privileges.
-- Column-level GRANTs are unaffected by table-level REVOKE.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.businesses FROM anon;

NOTIFY pgrst, 'reload schema';
