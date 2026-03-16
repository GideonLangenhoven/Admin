# CapeKayak Launch Success Checklist

## Purpose
Ensure launch traffic converts into paid customers through operational readiness, not just campaign activity.

## 1) Commercial Readiness
- Pricing, setup fee, top-ups, and add-ons are identical across:
  - website
  - sales deck
  - billing UI
  - proposal templates
- Plan recommendation rules are documented for sales:
  - Starter for solo operators and lower monthly paid bookings
  - Growth for teams up to 3 admins
  - Pro for larger teams and high paid-booking volume
- Top-up and upgrade guidance is available as a one-page internal script.

## 2) Conversion Infrastructure
- Primary conversion path (`/operators`) has one clear CTA above the fold.
- Calendly or demo-booking workflow is tested on mobile and desktop.
- Thank-you page + confirmation email are active after demo booking.
- Retargeting audiences are populated from day one.

## 3) Tracking and Analytics
- UTM naming convention is enforced in every campaign.
- Ad platform conversion events map to CRM opportunity stages.
- North-star KPI is visible daily:
  - paid booking conversion rate
- Secondary KPI dashboard updates daily:
  - demo requests
  - demo attendance
  - trial-to-paid
  - upgrade and top-up events

## 4) Sales Execution
- Same-day inbound response SLA is active.
- Demo script includes:
  - 15-minute product proof
  - 5-minute pricing fit recommendation
  - 5-minute implementation next step
- Follow-up sequence is prewritten:
  - no-show
  - attended/no decision
  - proposal sent
  - trial started

## 5) Onboarding and Activation
- New customer onboarding checklist exists and is owner-assigned.
- Time-to-first-paid-booking target is tracked per new account.
- First-week customer check-in call is scheduled at signup.
- High-friction onboarding steps are logged and prioritized weekly.

## 6) Support and Reliability
- Billing/payment support owner is assigned for launch week.
- Bug triage cadence is defined (at least twice daily during launch window).
- Incident template exists for payment, booking, and notification failures.
- Rollback path is validated from `docs/launch/deployment-runbook.md`.

## 7) Content and Trust Signals
- Case-study page includes quantified outcomes where available.
- Comparison page addresses top objections directly.
- FAQ includes:
  - setup fee scope
  - top-up expiry behavior
  - landing page hosting policy
- Founder proof content is scheduled for first 14 days.

## 8) Post-Launch Compounding
- Weekly launch recap email is scheduled.
- Feature/changelog cadence is scheduled to create the next launch moment.
- Referral motion is active with a clear reward and process.
- Day-14 retro is booked before launch starts.

## Minimum Launch Gate
- Do not scale ads until:
  - tracking is verified,
  - response SLA is met,
  - demo-to-paid motion is functioning,
  - billing edge cases are stable in production.

