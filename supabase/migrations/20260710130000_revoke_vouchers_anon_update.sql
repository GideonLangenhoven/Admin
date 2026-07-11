-- S3 regression: anon UPDATE grant on vouchers re-appeared after 2026-07-02 revoke
-- (likely restored by a broad re-grant). Inert (no anon UPDATE policy) but re-revoking
-- to match the security baseline.
REVOKE UPDATE ON public.vouchers FROM anon;
