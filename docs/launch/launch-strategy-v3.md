# CapeKayak SaaS Launch Strategy v3 - Execution Pack

## Offer Snapshot
- Setup fee: R3,500 once-off
- Starter: R1,500/month, 1 admin, 100 paid bookings/month
- Growth: R3,000/month, 3 admins, 500 paid bookings/month
- Pro: R6,500/month, 10 admins, uncapped paid bookings (fair-use)
- All core features are included on all plans.

## Add-ons
- Landing page build: R3,500 for the first page
- Additional landing pages: R1,500 per page
- Landing page hosting: R500/month per business

## Top-ups
- R100 = +10 paid bookings (current cycle)
- R500 = +60 paid bookings (current cycle)
- R1,000 = +140 paid bookings (current cycle)
- Top-ups expire at cycle end (no rollover)

## Volume Rule
Only paid bookings count toward monthly booking caps (`status = PAID` and `total_amount > 0`).

## Cap Behavior
- Starter/Growth: at cap, new paid bookings pause until quota is added.
- Immediate in-app options at cap:
  - Buy top-up
  - Upgrade plan
- Access restores instantly after successful payment.
- Pro is not cap-blocked, but paid-booking usage is still tracked.

## Deployment-First Rollout
Deployment is a launch phase, not just an engineering step. Complete production rollout and validation before public amplification.

### Phase 0 (Deployment)
- Run DB migrations, function deploys, and frontend release using `docs/launch/deployment-runbook.md`.
- Validate pricing, plan caps, seat limits, top-up crediting, and landing-page billing in production.
- Confirm public pages are live:
  - `/operators`
  - `/case-study/cape-kayak`
  - `/compare/manual-vs-disconnected-tools`

## Launch Timeline (2 weeks)

### Days 1-3
- Finalize `/operators`, case study, and comparison pages
- Confirm pricing and plan limits in production DB
- Verify cap/seat/top-up enforcement in staging

### Days 4-6
- Soft-launch with pilot operators
- Collect objections by plan tier
- Track cap events and upgrade/top-up behavior

### Days 7-10
- Publish comparison content and outreach posts
- Drive traffic to `/operators`
- Monitor demo and onboarding requests

### Days 11-14
- Full launch push across channels
- Run same-day response handling for inbound leads
- Publish first post-launch conversion summary

## ORB Channel Strategy

### Owned Channels (primary conversion engine)
- Website pages:
  - `/operators` as the primary conversion destination
  - Case-study and comparison pages as objection handlers
- Email:
  - Pilot follow-up sequence
  - Weekly launch recap with CTA to book demo/start onboarding
- Product channel:
  - In-app prompts at cap to buy top-up or upgrade
  - Billing page as commercial control center

### Rented Channels (distribution)
- LinkedIn: founder/operator problem-solution posts linking to `/operators`
- Instagram/Facebook: operator proof posts and short walkthrough clips
- Optional Product Hunt style push (if targeting broader SaaS audience), always linking back to owned channels

### Borrowed Channels (credibility)
- Partner referrals from tourism operators and local booking ecosystem players
- Guest mentions in operator communities and industry newsletters
- Pilot testimonials repurposed in outreach and sales deck

## Offer Positioning (No-Brainer)
- All core features included from day one on every plan.
- Pricing scales only by admin seats and paid booking volume.
- Add-ons are transparent and predictable:
  - Landing page build: R3,500 first page
  - Additional pages: R1,500/page
  - Hosting: R500/month per business (only if landing page add-on is active)

## KPI Targets (First 60 days)
- North-star: paid-booking conversion rate
- Secondary:
  - Demo request rate
  - Trial-to-paid conversion
  - Time-to-first-paid-booking
  - Starter -> Growth/Pro upgrade rate

## Core Messaging
- All features from day one. Scale only when your bookings and team grow.
- From inquiry to paid booking to operations in one system.
- Simple seats + volume pricing with predictable add-ons.

## Deployment
- Deployment runbook: `docs/launch/deployment-runbook.md`
- KPI queries: `docs/launch/metrics-sql.md`
- 14-day execution board: `docs/launch/execution-board-14-days.md`
- Ads playbook: `docs/launch/ads-playbook-v1.md`
- Day 1-7 ad creative pack: `docs/launch/ad-creative-pack-day1-7.md`
- KPI scorecard playbook: `docs/launch/kpi-scorecard-playbook.md`
- KPI scorecard template CSV: `docs/launch/kpi-scorecard-template.csv`
- Launch success checklist: `docs/launch/launch-success-checklist.md`

## Post-Deploy Launch Strategy (Execution Focus)

### Day 0 (Deployment Day)
- Deploy DB + functions + frontend using `deployment-runbook.md`.
- Run smoke tests for cap enforcement, top-ups, and landing-page add-ons.
- Confirm public pages are accessible and conversion CTAs are working.

### Days 1-3 (Activation)
- Send launch email to existing operator contacts.
- Publish first founder post linking to `/operators`.
- Run 1:1 onboarding calls with first pilot operators and capture objections.

### Days 4-7 (Iteration)
- Use `metrics-sql.md` to monitor:
  - top-up purchases
  - cap-reached accounts
  - landing-page add-on uptake
- Refine pricing FAQ and objection handling based on real conversations.

### Days 8-14 (Scale)
- Publish case-study and comparison page content in outreach.
- Push partner/referral outreach with a clear operator CTA.
- Review conversion funnel and finalize next release announcements.
