# User-Action Checklist — Things I Can't Do From Here

These four items require your dashboard / DNS / billing access. They're independent of the code work — you can do them in any order, any time. Together they unblock 3 of the 8 launch items.

---

## 1. P0-3 — Rebind `admin.bookingtours.co.za` to the `caepweb-admin` Vercel project (2 minutes)

The custom domain currently returns `DEPLOYMENT_NOT_FOUND` (verified via curl). The underlying deployment works — `caepweb-admin.vercel.app` returns the admin login page fine. The domain just needs to be re-attached to the project.

**Steps:**
1. Vercel dashboard → projects → `caepweb-admin` → Settings → Domains.
2. If `admin.bookingtours.co.za` is listed but says "Invalid configuration", click "Refresh" or remove + re-add.
3. If it's missing entirely, click "Add Domain" → enter `admin.bookingtours.co.za` → follow the DNS verification flow (the DNS already points at Vercel IPs, so this should pass instantly).
4. Wait for SSL cert issuance (Vercel does this automatically, usually <60 seconds).

**Verify:** `curl -sI https://admin.bookingtours.co.za/` should return `HTTP/2 200` (not 404).

---

## 2. P1-1 — Upgrade Supabase project to Pro (~30 minutes inc. billing)

Project `cape-kayak-bookings` (`ukdsrndqhsatjkmxijuj`) is currently on Free.

**Why mandatory:** auto-pause protection, point-in-time recovery backups, raised Realtime ceiling, raised edge-function quota, support SLA. Phase 1 §11 covers the math.

**Steps:**
1. Supabase dashboard → project `cape-kayak-bookings` → Settings → Billing.
2. Upgrade to Pro plan ($25/month → ~R470/month).
3. No downtime, no migration — Supabase upgrades in-place.

**Verify:** dashboard shows "Pro" badge under the project name.

---

## 3. P1-6 — Upgrade Resend to Pro plan (30 minutes inc. billing + key rotation)

Free tier is 3,000 emails/month. Projected need at 10 operators: ~23,500/month. Free will block at 100/day in the first hour of any active marketing day.

**Steps:**
1. Resend dashboard → Billing → upgrade to Pro ($20/month → ~R375/month).
2. Resend Pro auto-issues a new key OR keeps the existing one. If it issues new:
   - Update `RESEND_API_KEY` Vercel env var on **all three** projects: `caepweb-admin`, `booking`, `bookingtours-onboarding`.
   - Update `RESEND_API_KEY` Supabase edge-function secret (Supabase dashboard → Edge Functions → Secrets).
   - Redeploy the affected Vercel projects to pick up the new env var.
3. Run a test send via the admin "Send Test Email" feature (if available) or via the onboarding flow with a throwaway email.

**Verify:** Resend dashboard → Logs shows the test email arrived. Check the email landed in inbox not spam (next item).

---

## 4. P1-7 — Verify SPF / DKIM / DMARC for `bookingtours.co.za` (1 hour, mostly waiting)

If these DNS records aren't configured, Resend emails go to gmail/outlook spam folders. Customers think their booking confirmation never arrived.

**Steps:**
1. Resend dashboard → Domains → check whether `bookingtours.co.za` is verified.
   - If verified (green checkmarks on SPF, DKIM, DMARC): skip to step 4 (verification check).
   - If not: click "Add Domain", follow Resend's instructions. They'll give you 3–4 DNS TXT records to add at your DNS provider (likely Cloudflare or wherever the bookingtours.co.za zone lives).
2. Add the records exactly as shown. They look like:
   - SPF: TXT record at root (`@`) with `v=spf1 include:amazonses.com -all` (or whatever Resend specifies)
   - DKIM: TXT record at `resend._domainkey` with a long key
   - DMARC: TXT record at `_dmarc` with `v=DMARC1; p=quarantine; rua=mailto:dmarc@bookingtours.co.za`
3. Wait for DNS propagation (5–60 min). Resend dashboard refreshes verification status automatically.
4. **Verify:** send a test email to `check-auth2@verifier.port25.com` — they reply with a full SPF/DKIM/DMARC report. Or use https://www.mail-tester.com — paste the address it gives you into your "from" field, send, and read the score (target: 9+/10).

---

## After you've done all four

Tell me, and I'll re-run my verification checks (admin URL, anon SQL probe, etc.) before we ship the P0-1 admin-auth migration.

---

## Things I'll do (no action needed from you)

- ✅ P2-18 — `marketing-dispatch` cron now `*/5 * * * *` (done)
- ✅ P0-5 partial — `email-images` and `marketing-assets` now have 5MB / 10MB caps + image-mime-only restrictions (done)
- ✅ P0-4 — hardcoded `book.capekayak.co.za` defaults removed from admin code (done — needs a deploy of the `caepweb-admin` Vercel project to land in production)
- 🔄 P0-1 + P0-2 — admin-auth migration + RLS lockdown — **planning brief in chat next; awaiting your go-ahead before execution**

The P0-4 code change is committed locally; you'll need to push and let Vercel auto-deploy, OR I can git-commit it for you with your sign-off.
