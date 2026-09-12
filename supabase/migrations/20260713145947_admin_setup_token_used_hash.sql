-- M6: the setup-link idempotency fallback returned ok:true for ANY submitted
-- token (not just the real one) within 5 minutes of a legitimate completion,
-- because setup_token_hash is nulled on success and the fallback checked
-- only email + timing. Preserve the hash that was actually used so a retry
-- can be verified against it, not just assumed.
alter table public.admin_users add column if not exists setup_token_hash_used text;;
