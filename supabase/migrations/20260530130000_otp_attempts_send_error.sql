-- I1 diagnostics: the send-otp edge function swallows the Resend send result
-- (returns 200 even when the email send fails, to avoid leaking match-vs-no-match).
-- That made the My Bookings OTP non-delivery invisible: HTTP logs show 200 and
-- console output isn't queryable. This nullable column lets send-otp record the
-- per-attempt send outcome server-side (NO_RECIPIENT_MATCH / SENT_OK / "<status>:<body>")
-- so the actual Resend rejection is diagnosable. Rows expire with the OTP TTL, so
-- this self-cleans. No RLS change: the column inherits the table's existing policies.
ALTER TABLE public.otp_attempts ADD COLUMN IF NOT EXISTS send_error text;
