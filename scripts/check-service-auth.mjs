import { createClient } from '@supabase/supabase-js';

// Exercise the same server-to-email-service connection used by password resets.
// An unknown template stops after authorization and never sends an email.
if (process.env.VERCEL_ENV !== 'production' && !process.argv.includes('--force')) {
  console.log('Email service authorization check: skipped outside production');
} else {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Email service authorization check: missing server configuration');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  const type = 'SERVER_AUTH_CHECK';
  const { error } = await admin.functions.invoke('send-email', {
    body: { type, data: { email: 'no-delivery@example.invalid' } },
  });
  const response = error?.context;
  const body = response instanceof Response ? await response.json().catch(() => null) : null;
  if (response?.status !== 400 || body?.error !== `Unknown email type: ${type}`) {
    throw new Error(`Email service authorization check failed (HTTP ${response?.status ?? 'unavailable'}). Verify the production SUPABASE_SERVICE_ROLE_KEY against the deployed email service.`);
  }
  console.log('PASS email service authorization; no email sent');
}
