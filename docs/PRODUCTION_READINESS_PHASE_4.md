# Production-Readiness Review — Phase 4: Shared-Resource Contention

**Review target:** BookingTours platform (4 apps, shared Supabase + Resend + WhatsApp + Vercel + Firebase)
**Reviewer:** Claude (Opus 4.7)
**Date:** 2026-04-17
**Environment:** production Supabase via MCP; billing dashboards not available — limits inferred from Supabase Free-tier published ceilings and code-derived load projections.
**Status:** Phase 4 complete. **One new P0** surfaced on Supabase Storage. Running total: **5 P0s**.

Prior phases: `docs/PRODUCTION_READINESS_PHASE_{1,2,3}.md`.

---

## 0. New P0 — Storage bucket `email-images` grants `anon` write / update / delete

From `storage.policies`:

| Policy | cmd | roles | Effect |
|---|---|---|---|
| `email-images: public read` | SELECT | public | Anyone reads (intended — emails need to load images without auth) |
| `email-images: upload` | INSERT | **anon**, authenticated | **Anyone with the anon key can upload files** |
| `email-images: update` | UPDATE | **anon**, authenticated | **Anyone can modify existing files** |
| `email-images: delete` | DELETE | **anon**, authenticated | **Anyone can delete files** |

Bucket is configured with `file_size_limit: null` and `allowed_mime_types: null`. Anyone can upload arbitrary file types of arbitrary size. Attack vectors:

1. **Deface marketing emails.** Replace a logo or banner already referenced by a sent campaign URL with offensive or malicious content. Every recipient who opens the email loads the new image.
2. **Storage DoS.** Upload multi-GB files until Free-tier's 1GB storage ceiling is hit. No cost to attacker, real cost to you (either silent drops in production or forced upgrade).
3. **Malware hosting.** Use the bucket as file hosting for unrelated malware — your domain serves it, your reputation pays.
4. **Delete legitimate assets.** Break every currently-sent email that references deleted images.

Contrast with the `marketing-assets` bucket, which is properly scoped:
- INSERT / DELETE require `service_role` OR `authenticated` admin with folder-name = `business_id`.
- This is the correct pattern and should be mirrored on `email-images`.

**Fix (5–10 min SQL):**

```sql
DROP POLICY "email-images: upload" ON storage.objects;
DROP POLICY "email-images: update" ON storage.objects;
DROP POLICY "email-images: delete" ON storage.objects;

CREATE POLICY "email-images_service_role_write" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'email-images')
  WITH CHECK (bucket_id = 'email-images');

CREATE POLICY "email-images_authenticated_admin_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'email-images'
    AND (storage.foldername(name))[1] IN (
      SELECT business_id::text FROM admin_users WHERE id = auth.uid()
    )
  );
-- (similar for UPDATE and DELETE, guarded on folder = business_id)
```

Then set `file_size_limit` = e.g. 5MB and restrict `allowed_mime_types` to `['image/jpeg','image/png','image/webp','image/svg+xml']`.

**Severity:** P0-5. Same family as the RLS P0 from Phase 2 (policy misconfig granting `anon` writes). Not as bad (storage vs. bookings), but real and trivial to exploit.

---

## 1. Executive summary

For each shared resource: what's the limit, what's current usage, what's the 10-operator projection, and what's the headroom. Yellow flag at ≥70% utilisation, red flag at ≥90%.

| Resource | Limit | Current | Projected (10 ops) | Headroom | Flag |
|---|---|---|---|---|---|
| Supabase DB size | 500 MB (Free) / 8 GB (Pro) | ~4 MB (estimated from scale) | ~40 MB | 92% / 99.5% | Green |
| Supabase DB connections | 60 direct + pooler unbounded | 15 | ~30 | 50% direct | Green |
| Supabase edge-fn invocations | 500K / mo (Free) | ~86K/mo (cron alone) | ~180K/mo total | 64% | Yellow |
| Supabase Realtime concurrent | 200 channels (Free) | ~5–8 | ~50–80 | 60–75% | Yellow |
| Supabase Storage | 1 GB (Free) | unknown — bucket uncapped | unknown | unknown | **Red (P0-5 attack risk)** |
| Supabase bandwidth | 5 GB / mo (Free) | unknown | ~4–8 GB/mo estimate | tight | **Yellow-Red** |
| Supabase auto-pause | 7 days inactivity (Free) | cron fires ×1/min → no pause | same | n/a | Green (while cron active) |
| Resend email | 100/day, 3K/mo (Free) | small | ~21K/mo | **Exceeds Free 7×** | **Red** |
| WhatsApp API conversations | 1K free/month then paid | small | ~7K/mo | costs ~$15–20/mo | Yellow |
| Vercel bandwidth | 100 GB/mo (Hobby) | small | <10 GB/mo | ok | Green |
| Vercel Fluid Compute GB-seconds | 100 GB-s included (Hobby) | small | ~5 GB-s | ok | Green |
| Firebase Hosting bandwidth | 10 GB/mo (Spark) | small | ~1 GB/mo (105KB × 10K views) | ok | Green |
| Region-latency to Cape Town | 150–220 ms RTT to Paris | observed | same | n/a | Yellow — documented in Phase 3 |

**Headline:** three resources are either over or near their Free ceilings at 10-operator scale. Resend is the hard blocker — Free can't carry it. WhatsApp will incur modest costs (~$15/mo) above the free tier. Storage is safe from capacity but unsafe from attack (P0-5).

Upgrade paths after the Pro Supabase upgrade already recommended:
- Resend Pro (~$20/mo) → 50K emails/month, fine for 10–20 operators.
- Stay on WhatsApp Business API pay-as-you-go (Meta bills you for conversations 1001+).
- Vercel Hobby is fine until ~30 operators; revisit at that point.

---

## 2. Supabase — database layer

### 2.1 Current workload (since 2025-12-08 stats reset, ~4 months)

| Metric | Value | Notes |
|---|---|---|
| xact_commit | 9.78M | ~70K tx/day average |
| xact_rollback | 374K (3.8%) | Normal rate for a web app |
| Buffer cache hit ratio | 100.00% | 8.97B hits vs 129K reads — DB is fully cached in RAM |
| Tuples inserted | 308K | Mostly logs, outbox, chat messages |
| Tuples deleted | 232K | Holds churning constantly (short TTL) |

Extremely healthy. The database itself is not the bottleneck.

### 2.2 DB size projection

At 138 bookings, 1,363 slots, 926 chat_messages, 259 logs, 56 outbox (current totals), an upper-bound estimate for current DB size is ~4–8 MB of user data (not counting system catalogs or the WAL).

Pro tier at 8 GB gives roughly 1000× headroom. Free tier at 500 MB gives ~100× headroom. Neither binds at 10-operator scale.

### 2.3 Connection pool

Observed 15 active connections at review time. Supabase provides:

- **Direct connections:** 60 on Free, 120 on Pro. Used only by long-running or session-pinned clients.
- **Transaction-mode pooler (PgBouncer):** all PostgREST traffic goes through this. Effectively unbounded from the application's perspective.

Since 100% of the platform's DB traffic is PostgREST (`supabase-js` client) or edge-function `createClient` calls, none of them occupies a direct connection beyond the duration of one HTTP request. **No connection-pool concern at 10-operator scale.** This was a Phase 1 worry; investigation dismisses it.

### 2.4 pg_cron inventory (6 jobs)

| Job | Schedule | Target | Invocations/month |
|---|---|---|---|
| `expire-holds-db` | `* * * * *` (1 min) | Inline SQL — DB only, no edge fn | 0 edge-fn invocations |
| `queue-reminders` | `*/10 * * * *` | `reminder-scheduler` edge fn | 4,320 |
| `send-outbox` | `*/2 * * * *` | `outbox-send` edge fn | 21,600 |
| `cron-tasks-every-5-min` | `*/5 * * * *` | `cron-tasks` edge fn | 8,640 |
| `marketing-dispatch-every-minute` | `* * * * *` (1 min!) | `marketing-dispatch` edge fn | **43,200** |
| `marketing-automation-every-5-min` | `*/5 * * * *` | `marketing-automation-dispatch` edge fn | 8,640 |
| **Total cron-only edge-fn invocations** | | | **~86,400 / month** |

Add user-triggered (create-checkout, send-otp, send-email, confirm-booking), webhooks (yoco, paysafe, wa), and admin actions (admin-reply, process-refund, broadcast): at 10-operator × 700-booking/month scale, approximately:

- 700 create-checkout
- 700 yoco-webhook
- 700 confirm-booking (happy path) + 700 /success fallback = 1,400 (most skip due to idempotency)
- 2,100 send-whatsapp-text (3 msgs per booking)
- 700 send-otp (my-bookings lookups)
- 1,000 send-email (various)

**User + webhook subtotal: ~7,300 / month.** Under heavy use maybe 20K.

**Grand total per month projection at 10-op scale: ~95K–110K edge-fn invocations.**
- Supabase Free ceiling: **500K / month.** → ~20% utilisation. Green.
- Supabase Pro: same 500K included, overage at $2 / 1M. → no real concern.

### 2.5 Marketing-dispatch cron cadence is 5× too aggressive

`marketing-dispatch-every-minute` alone burns 43,200 edge-fn invocations per month — half of all cron traffic. The dispatcher reads pending queue, batches up to 50 emails per run, and sends via Resend's batch API.

At 10 operators, realistic marketing volume is <1000 emails/day = ~40/hour. The dispatcher needs to run roughly that frequently. A 5-minute cadence (`*/5 * * * *`) gives 288 ticks/day × 50 = 14,400 email capacity, more than sufficient, and cuts invocation count to 8,640/month — saving ~35K invocations and real money on Resend API calls.

**Recommendation:** drop to `*/5 * * * *`. 30 seconds of SQL. **P2-18.**

### 2.6 Auto-pause risk — re-assessment

Phase 1 flagged Supabase Free's 1-week auto-pause as a risk. The cron jobs fire every minute (`expire-holds-db`, `marketing-dispatch`), which counts as DB activity and prevents auto-pause. **Risk downgraded** — Free won't auto-pause *while cron is running*. But: if a cron is ever manually disabled (or pg_cron is somehow paused), the 7-day clock starts.

**Fix priority unchanged:** upgrade to Pro anyway, for backups and support.

---

## 3. Supabase — Realtime

### 3.1 Channel topology per admin session

Grep against the admin codebase found these subscriptions:

| Location | Channel name pattern | Lifetime |
|---|---|---|
| `app/page.tsx:271` | `dash-bookings-{businessId}` | Open while dashboard page is mounted |
| `app/bookings/page.tsx:278` | `bookings-status` | Open while bookings page is mounted |
| `app/inbox/page.tsx:134` | `inbox-chat-{Date.now()}` | Open while inbox page is mounted. **Channel name includes `Date.now()`** — see below |
| `components/NotificationBadge.tsx:20` | `inbox-badge` | Always open (in AppShell) |
| `components/RefundBadge.tsx:18` | `refund-badge-{businessId}` | Always open |

So an operator with the admin open has at minimum 2 channels (badges) and up to ~5 if they're navigating through dashboard → bookings → inbox.

Booking-site app has no Realtime subscriptions. Customer browsers don't hit Realtime.

### 3.2 Channel-leak risk in the inbox

`inbox-chat-` + `Date.now()` generates a *new* channel name every time the React effect runs. If cleanup is imperfect, repeated navigations to `/inbox` accumulate dead channels that stay subscribed until page reload.

Looked at `inbox/page.tsx:134` — there's a `useEffect(() => { return () => supabase.removeChannel(ch); }, [...])` pattern elsewhere in the codebase. Need to read the full `inbox/page.tsx` cleanup logic to confirm it works. **Flag as P2-19 — investigate.**

### 3.3 Concurrent-channel projection

| Scenario | Channels | Limit (Free) | Headroom |
|---|---|---|---|
| 1 operator browsing admin | ~3–5 | 200 | huge |
| 10 operators simultaneously on admin | ~50 | 200 | 75% of limit |
| 10 operators × 2 browser tabs each | ~100 | 200 | 50% of limit |
| 20 operators × 2 tabs + inbox leak | ~160–200 | 200 | **at the wire** |

**Yellow flag** for Realtime at 20+ operators or if the inbox channel leak is real. Pro tier raises the limit to 500, removing the concern.

---

## 4. Supabase — Storage

### 4.1 Buckets

| Bucket | Public? | File size limit | Mime types | Note |
|---|---|---|---|---|
| `email-images` | true | **unlimited** | **any** | **P0-5 — anon write/delete/update** |
| `marketing-assets` | true | unlimited | any | Writes properly scoped to admin's business_id — good |

### 4.2 Bandwidth math

Free tier gives 5 GB egress/month. At 10 operators × 5000 email sends/month × 2 images × ~100 KB each = 10 GB/month → exceeds Free **2×**. Pro tier gives 250 GB → fine.

This is the other edge of the Resend volume — not just emails, but the images those emails reference are served out of Supabase Storage. Unless you CDN-cache them on the client, each open pulls bytes.

**P2-20:** add CDN caching headers (`cache-control: public, max-age=86400, immutable`) on `email-images` bucket. Reduces egress on repeat opens.

---

## 5. Resend — email

### 5.1 Call sites

Grep found 8 Resend `fetch` call sites across the platform, the main consumers being:

- `send-email` edge fn — every transactional email
- `send-invoice` edge fn — invoice PDFs
- `outbox-send` edge fn — drains the outbox queue
- `marketing-dispatch` edge fn — campaign batch sends
- Onboarding `/api/onboarding/route.ts` — welcome + super-admin notification

All use a single `RESEND_API_KEY`. One key, shared across everything, no per-app isolation.

### 5.2 Volume projection at 10-operator scale

| Source | Per month |
|---|---|
| Booking confirmations (1/booking) | 700 |
| Reminder emails (~2/booking) | 1,400 |
| Review requests (~1/booking) | 700 |
| Refund notifications (~5% of bookings) | 35 |
| Invoices (1/paid booking) | 700 |
| Marketing campaigns (conservative: 1 weekly blast × 500 contacts × 10 ops) | 20,000 |
| Onboarding welcome + super-admin notif | 2 |
| **Total** | **~23,500 / month** |

Resend tier limits:

- **Free:** 3,000 / month, 100 / day. **Covers ~1 operator's transactional + light marketing. Blocks at ~200 emails/day.**
- **Pro ($20/mo):** 50,000 / month, 10 req/s. **Comfortable for 10–20 operators.**
- **Business ($90/mo):** 100,000 / month, 10 req/s. For 30+ operators.

**Headline:** Resend Free cannot carry 10 operators. Upgrading to Pro is mandatory before launch. At R1,500/month per operator, $20 Resend is 0.1% of one operator's fee.

### 5.3 Dispatch concurrency

Marketing-dispatch fires every 1 min, batch of 50 via `/emails/batch`. Resend batch API accepts up to 100/batch, 10 req/s. Well within limits.

Transactional sends fire directly from user actions (confirm-booking → send-email). Assuming max 20 simultaneous paid bookings platform-wide, 20 req to Resend in parallel — still within the 10 req/s ceiling if Resend batches arrivals. Not measured directly — **live test needed** in staging.

### 5.4 Deliverability risk

`noreply@bookingtours.co.za` is the sender. The domain is new-ish; SPF/DKIM/DMARC must be configured on the `bookingtours.co.za` DNS for Resend, or emails land in spam. **Untested from this review. P1-7.**

---

## 6. WhatsApp Business API

### 6.1 Call sites

7 `graph.facebook.com` fetch sites, all inside edge functions. Per-business credentials (`waToken`, `waPhoneId`) are encrypted in `businesses.credentials` JSONB.

### 6.2 Volume projection

WhatsApp bills per *conversation* (not per message). A conversation = 24-hour window with one customer.

At 10 operators × 700 bookings × ~1 conversation per booking (confirmation, reminders, day-of) = 7,000 conversations/month.

WhatsApp tier pricing (as of 2026 knowledge; pricing shifts periodically):
- First 1,000 service conversations/month are free per WhatsApp Business account.
- Above 1,000: ~$0.003–$0.025 per conversation depending on country and category (utility vs marketing).
- Zambia/South Africa utility rate is roughly $0.003.

**Estimated WhatsApp cost at 10 operators:** (7,000 - 1,000) × $0.003 = **~$18 / month**. Modest.

### 6.3 Messaging tier

Meta tiers WhatsApp accounts by 24-hour conversation capacity. A fresh tenant starts at Tier 1 (250/day). At 10 operators × 3 conversations/day = 30/day — within Tier 1.

**At 50+ operators** this hits Tier 1's cap. Tier promotion requires Business Verification via Meta Business Manager.

### 6.4 Rate limiting

Meta Graph API rate limits for messaging: 80/s default for tier 1. Burst of 20 confirmation sends from one cron tick × 10 operators = 200 send-whatsapp-text invocations; at 80/s = 2.5 seconds — within tolerable edge-fn execution time.

No contention expected at 10-op scale.

---

## 7. Vercel

### 7.1 Fluid Compute

Three Vercel projects: `caepweb-admin`, `booking`, `bookingtours-onboarding`. Each on its own Fluid Compute allocation.

- Hobby plan: 100 GB-hours (GB-s × 3600) / month included.
- Pro plan: 1000 GB-hours included.

At 10 operators, admin dashboard gets maybe 100 page-views/op/day × 10 = 1,000 views/day × 500 ms execution × 256 MB memory ≈ 0.003 GB-hours/day × 30 = 0.1 GB-hours/month. Trivial. No concern.

### 7.2 Cold starts

Fluid Compute reuses function instances across concurrent requests, dramatically reducing cold-start frequency. Observed `age: 727566s` CDN cache on the `aonyx.booking.bookingtours.co.za` HTML — the static shell is cached 8 days, so cold starts only affect fresh deploys or genuinely idle functions. Not measured end-to-end.

### 7.3 Bandwidth

Hobby: 100 GB/month. Admin + booking site at 10-op scale < 10 GB/month. Green.

### 7.4 Build minutes

Not measured. Typical Next.js build in 2–3 min; 3 projects × 2 builds/week = 36 min/month. Hobby cap is high enough to ignore.

---

## 8. Firebase Hosting (landing site)

Landing page is 105 KB per page view. Spark (free) tier: 10 GB egress/month.

At 10 operators × 1000 landing visits/op/month = 10,000 views × 105 KB = 1 GB/month. Green.

No concern.

---

## 9. Concurrent scenario analysis

### Scenario A — 10 operators on admin + 5 customers booking + all cron running (the "real Monday morning")

| Resource | Peak usage | Limit | Verdict |
|---|---|---|---|
| DB connections | ~25 (all pooled) | pooler effectively unbounded | Pass |
| Realtime channels | ~50 | 200 | Pass |
| Edge-fn concurrent invocations | ~10 simultaneous | 100 on Free | Pass |
| PostgREST queue | ~20 in-flight | 500 req/s per project | Pass |

Pass.

### Scenario B — Payment burst (20 simultaneous checkouts, e.g. a weather-triggered rebook storm)

| Resource | Peak | Verdict |
|---|---|---|
| 20 × create-checkout | concurrent | Pass — under 100 fn invocations |
| 20 × Yoco webhook arrivals | concurrent | Pass |
| 20 × confirm-booking | concurrent | Pass |
| 20 × send-email from confirm-booking | ≈ 20 Resend requests/s | **Above Resend default 10 req/s** — may queue. Needs a test. **P2-21.** |
| 20 × send-whatsapp-text | within Meta 80/s | Pass |

Borderline pass on Resend — may need a batching layer.

### Scenario C — Marketing campaign day (10 operators × 1000-contact newsletter simultaneously)

10,000 emails to send. Marketing-dispatch runs every minute (*/1) or every 5 min (*/5 recommended), batches of 50. At current cadence: 10,000 ÷ 50 = 200 batches. At 1/min = 200 min = 3.3 hours to fully drain. At 5/min = 1000 min = 16 hours to drain.

**Recommendation:** leave marketing-dispatch at 1/min ONLY during active campaigns; run at 5/min normally. Better: make dispatch fire more often when queue depth > threshold. **P2-22 (nice-to-have).**

Resend Pro handles 10,000 emails comfortably (1000/hour × 10 hours, well within 10 req/s).

### Scenario D — Realtime storm (20 ops each refreshing dashboard, 5 new bookings fire Realtime events)

Realtime channels: 20 × 5 = 100. Under 200.
Each booking INSERT triggers N channel broadcasts (per-businessId subscriber). Supabase Realtime handles the fanout; 5 events × 20 subs = 100 messages, well under the 2M/mo cap.

Pass.

### Scenario E — Database connection pool saturation (Phase 1 worry)

Re-examined in §2.3. Not a real concern because everything uses the pooler. Dismissed.

---

## 10. Findings catalogue — Phase 4 additions

| ID | Severity | Title | Fix effort |
|---|---|---|---|
| **P0-5** | **P0** | `email-images` storage bucket grants anon INSERT/UPDATE/DELETE | 10 min SQL |
| **P1-6** | P1 | Resend Free plan cannot carry 10-operator volume (3K/mo vs 23.5K projected) | 30 min (Pro signup + key rotation) |
| **P1-7** | P1 | SPF/DKIM/DMARC on `bookingtours.co.za` not verified — deliverability risk | 1 hour (DNS work + Resend verification + mail-tester.com run) |
| **P2-18** | P2 | `marketing-dispatch` cron fires every 1 min; */5 is sufficient | 30 sec SQL |
| **P2-19** | P2 | Inbox Realtime channel uses `Date.now()` in name — potential leak on re-navigate | 1 hour review + fix |
| **P2-20** | P2 | `email-images` bucket egress uncached — repeat opens repull bytes | 15 min (CDN cache headers) |
| **P2-21** | P2 | 20 simultaneous `confirm-booking → send-email` exceeds Resend 10 req/s; needs batching or test | 1 day to verify in staging |
| **P2-22** | P2 | Bulk marketing runs take hours to drain at 5-min cadence | 4 hours (queue-depth-based dispatcher) |
| **P2-23** | P2 | Meta WhatsApp Business Verification not mentioned — needed for Tier 2+ | 1 day (Meta Business Manager) |
| **P3-5** | P3 | `email-images` bucket has no file-size or mime-type limit | 5 min |

---

## 11. Running total after Phase 4

| Phase | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Phase 2 | P0-1, P0-2 | P1-1 … P1-5 | P2-1 … P2-12 | P3-1, P3-2 |
| Phase 3 | P0-3, P0-4 | — | P2-13 … P2-17 | P3-3, P3-4 |
| Phase 4 | **P0-5** | P1-6, P1-7 | P2-18 … P2-23 | P3-5 |
| **Total** | **5 P0s** | 7 P1s | 23 P2s | 5 P3s |

### Infrastructure upgrades needed before launch

| Service | From | To | Cost | Reason |
|---|---|---|---|---|
| Supabase | Free | Pro | $25 / R470 | Backups, auto-pause protection, Realtime ceiling, edge-fn overage |
| Resend | Free | Pro | $20 / R375 | Volume — Free blocks at 100 emails/day |
| WhatsApp Business Verification | unverified | verified via Meta Business Manager | one-time | Tier 2+ unlocks, prevents daily caps |
| DNS (SPF/DKIM/DMARC) | unknown | configured | 0 | Email deliverability |

Total ongoing cost uplift: ~R850/month. <1 operator's fee covers the entire platform infrastructure tier upgrade.

---

## 12. Sign-off gate for Phase 5

Phase 5 consolidates everything into the failure-mode catalogue and remediation plan. It does not require new data gathering — all the signal is in phases 1–4. I can draft it now.

Before I do, I'd like you to confirm one thing: **the 5 P0s, in the priority order I'd fix them:**

1. **P0-3 — Rebind `admin.bookingtours.co.za` to the Vercel admin project.** 2 minutes, pure Vercel UI. Do this first — zero blast radius.
2. **P0-1 + P0-2 — Drop the 33 permissive RLS policies, add scoped anon policies, route admin reads via service-role, force-reset admin passwords, migrate hashing to bcrypt.** ~1 day. Biggest blast radius but the highest-impact security fix.
3. **P0-5 — Drop the 3 anon write policies on `email-images` bucket, add scoped policies, set file-size and mime-type limits.** 10 minutes. Do right after P0-1 to avoid forgetting.
4. **P0-4 — Rebind `book.capekayak.co.za` DNS to Vercel or remove the hardcoded defaults in admin code.** 30 minutes.

Is this sequence sensible, or do you want P0-3 and P0-4 done first because they're trivial? Either way, Phase 5 is ready to draft on your signal.
