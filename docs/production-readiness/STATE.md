# BookingTours production-readiness checkpoint

The user-authorized all-changes release on 2026-10-21 is live at https://admin.bookingtours.co.za as `dpl_5ujG6ZE9Pko6dCJAANGn8kKPiN7K`. Simple View now follows the next departure and uses dashboard payment recovery below its heading. Bookings hides reference/source labels, shows full names, and places mobile return counts at the far left; View retains source details. The release also includes pending waiver-email controls, dashboard refinements, and three backend wording updates. Newer cancellation flows and production fonts are preserved. The customer site is already current (171 source files verified). All 518 admin source files, seven candidate and seven live mocked browser checks, eight live HTTP routes, and all three deployed backend sources are verified. Unit tests have 2,651 passes, 58 skips, and four failures reproduced on the prior live baseline. Three help chunks are synchronized. No new migrations or real customer actions were performed. This does not resume the broader qualification rollout. Evidence: `evidence/ALL_FINAL_DEPLOYMENT_20261021.json`.

The 2026-10-21 dashboard shortcut and Roll Call contact update is live as `dpl_8XGtsZSMLdftJw4Phjz8fih764gG` at https://admin.bookingtours.co.za. Existing admin shortcuts are removed. Mobile Roll Call uses separate guest cards, and WhatsApp, phone and email icons sit beside each guest name on mobile and desktop in the dashboard, Simple View and Check-ins. Contact validation, accessible labels, arrival checks and count-edit pencils are preserved. All 517 source files and four candidate plus four live routes were verified. Production build, active-app typecheck and 48 focused checks pass; lint has zero errors and nine existing warnings. Two help chunks are synchronized. No Chrome, Playwright, physical-device checks, customer actions, database changes or Edge Function changes were used. Evidence: `evidence/ROLL_CALL_CONTACT_ICONS_LIVE_20261021.json`.

The 2026-10-21 next-manifest and arrival-pencil update is live as `dpl_F9Gu4GcQHhe6rPaR1buU3aqkvsqV` at https://admin.bookingtours.co.za. Manifest shows only the next booked departure time with the existing four-minute grace period; concurrent activities stay separate. Roll Call follows the next departure automatically. Guest names and Resolve waiver have no underline. A pencil beside each guest count replaces Edit arrival counts and opens that booking’s Guests arrived input. The newer deployed dashboard layout, contacts, reports and navigation were preserved. All 517 source files, four candidate routes and four live routes were verified. Production build, active-app typecheck and 44 focused unit checks pass; lint has zero errors and eight warnings. Three help chunks are synchronized. No Chrome, Playwright, customer actions, database changes or Edge Function changes were used. Evidence: `evidence/NEXT_MANIFEST_ARRIVAL_PENCIL_LIVE_20261021.json`.

The user-authorized 2026-10-21 release is live at https://admin.bookingtours.co.za as `dpl_GUYkbCn7rkk6pgqPuBAPzMSF2oY2`. The 14 remaining runtime files cover New Booking mobile selectors and post-save navigation, payment recovery cleanup, Inbox mobile layout, grouped booking reports, Billing and Broadcasts. All 509 app source files were verified. Seven candidate and seven production routes passed HTTP, script, stylesheet and released-copy checks. The customer booking site is already current (171 source files verified). Web-chat human-request WhatsApp alerts are active in function version 156; the other functions changed today were already current. Twelve help chunks were updated and two obsolete chunks removed, with all 177 verified. Production build, active-app typecheck, web-chat typecheck and focused tests pass; the full suite has 2,625 passes, 58 skips and two previously reproduced baseline failures. No migrations, Chrome, Playwright or real customer messaging were used. Actual WhatsApp delivery was not exercised; out-of-window alerts require the approved Meta template described in Inbox help. Evidence: `evidence/ALL_CHANGES_DEPLOYMENT_20261021.json`.

The user-authorized 2026-10-21 booking and roll-call update is deployed at https://admin.bookingtours.co.za as `dpl_9NnBmByYwKYiUMotbiuPZb86gxaJ`. Bookings now has Day/Week views (Monday–Sunday) and Today selects only the business-local day. Arrival notices say “Confirm booking” and “waiver needed”; dashboard Roll Call opens validated WhatsApp numbers; Follow schedule and automatic departure switching are removed. All 504 uploaded source files are verified, preserving 499 live files. The production build, active-app typecheck, 37 focused/help unit cases, four local, four candidate and four live browser cases pass. Help is synchronized. No database migrations or customer actions were performed. Pending cancellation follow-up and unrelated copy work remain local. Evidence: `evidence/BOOKING_WEEK_DEPLOYMENT_20261021.json`. This scoped release does not resume the wider qualification rollout.

The user-authorized 2026-10-20 operator cleanup is deployed and verified at https://admin.bookingtours.co.za as `dpl_8NLhGqV78Bn9kH1JhyH6ctL246g9`. It publishes the dashboard/manifest and inbox cleanup, Simple View contact buttons and paid-only arrival controls, and removal of Bookings exports. All 503 uploaded source files match the reviewed candidate; 488 files from the prior live release are preserved. Migration `20261020160000_simple_paid_arrivals` is applied with unchanged function permissions. The production build, active-application typecheck, 62 focused/help unit cases, 22 local database acceptance groups, four candidate and four live browser cases pass. Six help chunks are synchronized. Browser checks use synthetic data; no customer messages, payments or arrival records were changed. Evidence: `evidence/OPERATOR_CLEANUP_DEPLOYMENT_20261020.json`. This scoped product release does not change the wider qualification gate.


Rollout status: PAUSED_BY_USER on 2026-09-28. The user is focusing on the demo.
Do not resume production qualification, migrations, load or soak tests, provider
changes, or the public launch switch until the user explicitly resumes the rollout.
The user separately approved phone push alerts for human web chats as a scoped
exception on 2026-09-28. Migration `20260928102000_admin_web_push_subscriptions`
is applied and verified with RLS; `web-chat` Edge function version 146 is active;
the three Admin production push variables are stored in Vercel. Admin commit
`27975a7` passed its preview build and local checks, but production deployments
`dpl_8bCwiDTMVgvW5u2RR1vruxsB9RN2` and
`dpl_GAWxNhsBXuqM1pQPfyxbAptZVHMK` were blocked before build because Vercel
reports that commit author `info@capeweb.co.za` lacks deployment permission for
the project (`TEAM_ACCESS_REQUIRED`). After the user updated account access,
retry `dpl_3qWFey85bPToZ8b6LjLtxzDKxzvM` hit the same block. The project is
owned by a one-member Vercel Hobby team; its owner must be recognized as the
commit author through the connected GitHub account or a verified matching
email. The live Admin
alias remains on healthy
deployment `dpl_J4YaSoG8hocjsDiRnzoSEXZR5ApC`. Edge secrets `ADMIN_PUSH_URL`
and `ADMIN_PUSH_SECRET` were unset until the matching Admin route can be
deployed, so guest chat behavior remains unchanged. To finish this exception,
verify/approve the commit author in Vercel, redeploy commit `27975a7`, restore
the Edge secrets from the protected rollout bundle, and test a phone opt-in and
human chat notification. This does not change FAILED_GATE or resume the broader
rollout.
The user separately authorized the 2026-09-28 Google Drive/media deployment:
admin app commit `bd0fac5` (Vercel `dpl_B7oUczno61wb1tRRz66VFTHX4GYn`) and
`google-drive` Edge function version 35. This does not change the FAILED_GATE
verdict or qualify the broader release.
The follow-up demo navigation update, commit `470ff08`, is deployed to the
Admin production alias as Vercel `dpl_J4YaSoG8hocjsDiRnzoSEXZR5ApC`.
The preview and production builds passed; the production alias and Guide/Photos
routes returned HTTP 200, and the unauthenticated Data Requests count endpoint
returned HTTP 401. The scoped authenticated browser smoke could not start
because its Supabase test sign-in token was rejected as expired. This UI
deployment does not resume production qualification or change FAILED_GATE.

On 2026-10-01 the user explicitly requested a working Kayak demo alongside
Claire's Hiking, with daily booking data and a populated booking page. This
scoped demo exception is complete: migrations `20261001090000` and
`20261001091000` are applied to the existing project. Claire's refresh now avoids
departure-time uniqueness collisions; its job runs at 00:05 South African time.
Kayak has 129 synthetic bookings and matching invoices, 12 fictional guests,
and three populated tours, with a refresh scheduled for 00:07 South African time.
Original Kayak bookings, staff access, tour prices, capacities and paid usage
were preserved. Synthetic records do not trigger provider payments or messages.
Booking deployment `dpl_2uYBsfzT5riGCoVo3kkCbcyBeK5A` is published. Its isolated
source contains the Kayak storefront changes and preserves the already deployed
navigation change from `dpl_GKee8R3EvLK47igcf2qJtSJL36Xp`. All nine read-only
public browser checks pass across desktop Chrome, phone Chrome and phone WebKit
on the actual Kayak and Claire's tenant domains. Detailed scope, daily refresh
checks and aggregate live verification are recorded in
`evidence/KAYAK_DAILY_DEMO_20261001.json`. This exception does not resume the
broader rollout or change FAILED_GATE.

The user subsequently requested the previous Kayak layout on 2026-10-01.
That presentation-only restoration is published as
`dpl_B1WFFDH2F7gjzY628cc2KVsrZ1Jo`. Home, booking and navigation source match
the original layout deployment, with the mobile cookie/booking-button fix
retained. Migration `20261001131000` restores the previous hero, background
and footer presentation settings. Demo bookings, invoices, customers, slots,
staff access and both daily jobs were verified unchanged. All nine public
desktop/phone browser checks pass. Evidence is recorded in
`evidence/KAYAK_LAYOUT_RESTORED_20261001.json`. The broader rollout remains paused.

The user separately authorized the shared guest calendar visual redesign on
2026-10-01. Production deployment `dpl_HfxVu4rKbgP8YobipgnzU26SBzzs` is published
and verified on the Kayak tenant domain. Its isolated source preserves the
previous production deployment and changes only the booking page presentation
and calendar/departure CSS. All 92 business declarations and 56 interaction
attributes match the previous source. Live browser checks pass at 320–1440px,
with no overlap or horizontal overflow, and cover accessible states, navigation,
selection, deep links, draft persistence and Continue/Back. The six existing
read-only tenant checks pass on desktop Chrome, phone Chrome and phone WebKit.
No booking, payment, notification or database change was submitted. Evidence,
screenshots, the exact patch and unrelated defect notes are in
`evidence/CALENDAR_REDESIGN_20261001.json`. This scoped visual deployment does not
resume the broader rollout or change FAILED_GATE.

The 2026-10-01 catalogue continuation is published: booking deployment
`dpl_eFbqMkYez62RS1HuUSwZgRdGUs9L` and Admin preview deployment
`dpl_7ZU93vPu7jXr3A5BC1VYujGLXkjN` are READY on their live domains. The
isolated sources preserve the deployed calendar and Admin revision `43304b6`.
Seven storefront files and six Admin files changed; the Admin scope includes
anchoring `/booking/` in `.vercelignore` so the shared preview components are
uploaded. All catalogue data-loading and settings-saving declarations are
unchanged. Both production builds, TypeScript, 76 focused checks, 15 fixture
browser checks and nine live tenant browser checks pass. The preview uses
visible tours and responds to unsaved configuration changes; saved palettes,
backgrounds, fonts, copy, branding and URLs remain operator-controlled. No
catalogue price or action is covered by the chat launcher on narrow phones;
the launcher uses reserved header space and keeps its existing dialog behavior. No
live operator settings, bookings, payments, notifications or database records
were submitted by this task. Evidence, screenshots and exact patches are in
`evidence/CATALOGUE_POLISH_20261001.json` and `evidence/catalogue-polish-20261001/`.
The broader rollout remains paused and FAILED_GATE is unchanged.

The 2026-10-02 booking white panels visual update is published: booking deployment
`dpl_DUxb9t2yu3t3pkAYE8uWfaGSXYBP` is READY on its live domain. The isolated
source preserves the deployed catalogue baseline `dpl_eFbqMkYez62RS1HuUSwZgRdGUs9L`
and updates only the booking workflow presentation panels (`app/book/booking-panels.css`,
`app/book/layout.tsx`, `app/book/page.tsx`). The calendar and booking details cards
now render on opaque white surfaces with dark ink typography and operator-colored
primary action buttons. Production build, TypeScript, lint, live HTTP 200 responses,
and visual browser smoke tests on `https://kayak.booking.bookingtours.co.za/book?tour=96e07644-315b-4e96-8f36-bb070b665cf8`
pass. Evidence and live screenshot are recorded in `evidence/BOOKING_WHITE_PANELS_20261002.json`
and `evidence/booking-white-panels-20261002/`. The broader rollout remains paused and
FAILED_GATE is unchanged.

Updated: 2026-10-02T07:20:00Z
Verdict: FAILED_GATE.

The exact Admin candidate `71da0361db65dd63f90b5110648b96b2c4ff3567` and booking companion `2ff1d82` are deployed. The controlled five-migration package is applied, all 55 Edge Functions are active, Admin deployment `dpl_6XfJvbbYuWDTvR8KCgbCgbJs14K6` serves `admin.bookingtours.co.za`, and booking deployment `dpl_Gb2ULvtZBjNej8STiNyejxfdbc5i` serves `booking.bookingtours.co.za`. The deployment aliases return HTTP 200, the remote migration ledger is exact, scheduler prerequisites exist once, and unauthenticated cron requests are rejected.

The deployed four-case browser smoke passes against the active `claires-hiking` storefront and Admin. The apex storefront is a directory and correctly shows zero operators because the active tenant is not directory-visible; it is not the tenant smoke target. Scheduled notification, marketing and cleanup work is succeeding.

The bounded deployed BT500 staff smoke reached 500 VUs and failed decisively. It was stopped after approximately 144 seconds to limit impact: 35.19% unexpected action failures, 30.82% failed HTTP requests, read-action p95 30.004 seconds and write-action p95 61.486 seconds. Follow-up Supabase telemetry confirms target-side queueing: direct load traffic remained 2xx at the edge while origin p95 rose from 221ms to 11.975s, then returned to 179ms after the abort. The base Pro project has Micro compute, no compute add-on and a 60-connection database limit. Local networking may have contributed to the cross-origin dial failures, but it cannot explain the recorded Supabase origin delay. The 24-hour qualification clock did not start.

The abort preserved integrity. Marker-specific tenant, arrival-audit, capacity, refund/capture, hold and idempotency checks remained at zero. Twelve pre-existing non-marker `PAID` records without provider IDs remain a separate baseline finding. One scheduled HTTP request timed out during the load window; the next minute's scheduled requests succeeded. The post-stop browser recovery smoke passed 4/4. The marker fleet was removed (500 auth users and 167 businesses), the private credentials were deleted, and database counts returned exactly to the pre-test baseline.

Local corrective work and source verification remain valid: 1,355 unit tests pass with one intentional skip, TypeScript and all Edge checks pass, both production builds pass, the responsive Simple View browser run passes, and npm audit reports zero vulnerabilities. A new local, undeployed capacity patch replaces the dashboard's approximately eleven concurrent Supabase reads with one tenant-scoped `SECURITY INVOKER` snapshot RPC, adds its five query indexes, coalesces Realtime bursts and updates the BT500 dashboard action without changing the approved workload or thresholds. The expanded disposable PostgreSQL suite passes 188 checks; TypeScript, the Admin production build, focused unit tests and the workload contract pass. Authoritative Auth, MFA ownership, refund authority, partial-arrival integrity and durable transactional notifications remain integrated in the deployed candidate.

Release qualification remains blocked by the failed capacity gate plus the previously open provider-double/public/background harnesses, genuine provider sandbox journeys, browser-derived Realtime measurement, representative-volume data, quota/headroom evidence, alert delivery drill, reviewed post-migration security baseline, and isolated restore target. No live provider messages, charges, refunds, provider-account changes, paid scaling or public launch switch occurred.

The minimum next capacity action is review and exact approval of the local corrective candidate, a single-migration rehearsal/deploy, then a progressive rerun from an instrumented independent generator with generator saturation and remote Supabase/Vercel resource metrics captured at each plateau. Do not begin the 60-minute steady phase or 24-hour soak until the unchanged 500-user smoke thresholds pass, provider doubles are enabled, and the remaining harness gates are executable.

Detailed deployed-smoke evidence is recorded in `docs/production-readiness/evidence/BT500_DEPLOYED_SMOKE_20260922.json`; the follow-up attribution and undeployed remediation are in `docs/production-readiness/evidence/BT500_CAPACITY_DIAGNOSIS_20260922.json`.

The user-authorized 2026-10-02 agent foundation release is published to Admin:
`dpl_8SAj3nTCJB6CAMrxzD4EYRHxoPrC` is READY and serves
`admin.bookingtours.co.za`. Its isolated source preserves all 445 existing files
from `dpl_7ZU93vPu7jXr3A5BC1VYujGLXkjN` and adds four runtime files for the
disabled agent read foundation and consent-aware acquisition report helper.
All 101 focused tests, TypeScript and the Vercel production build pass. Five
live agent HTTP cases return `503 INTEGRATION_DISABLED` with `no-store`; the
Admin home returns 200 and the unauthenticated Admin API returns 401. Public
requests without deployment protection bypass also return 200 for Admin and
503 for the agent endpoint. No agent SQL candidate or migration was uploaded
or applied, and no provider connection or acquisition intake flow was enabled.
Evidence is in `evidence/AGENT_FOUNDATION_DEPLOYMENT_20261002.json`. This scoped
source deployment leaves the wider rollout paused and `FAILED_GATE` unchanged.

On 2026-10-03 the user requested deployment of the changes made on 2026-10-02.
The restored traveller catalogue and matching Admin Booking Page Preview are
published as booking `dpl_3QgwFZKnDSUuPkcfCxFtsgdpvT2b` and Admin
`dpl_7Gy8PAtiUue5QERVdTkEWR29eZJS`, both READY on their live domains. The
booking source changes six presentation files and preserves the other 157
files, including the white booking panels and calendar. A concurrent Admin
agent-safeguard release, `dpl_32yBpxp6MkoQ65d1bfiriymbSyQR`, was detected
before promotion. The tested candidate preserves all its changes and differs
only in the three preview presentation files; its other 448 uploaded files
match that release. Owner-only access, seven-day grant checks and the pending
reschedule safeguard are therefore preserved in the disabled agent foundation.
Both production builds, TypeScript checks, focused lint and all 128 focused
agent tests pass. The nine read-only browser checks pass both before promotion
and on the actual Kayak and Claire's domains across desktop Chrome, phone Chrome
and phone WebKit. The public Admin home returns 200; the agent endpoint returns
503 `INTEGRATION_DISABLED` with `no-store`. Authenticated Admin preview browser
verification was not performed. No SQL migration, provider connection, booking,
payment or notification submission was made. Evidence and source manifests are
in `evidence/YESTERDAY_CHANGES_DEPLOYMENT_20261003.json` and
`evidence/yesterday-release-20261003/`. The wider rollout remains paused and
`FAILED_GATE` is unchanged.


Additional 2026-10-03 agent foundation verification confirms Admin deployment
`dpl_7Gy8PAtiUue5QERVdTkEWR29eZJS` remains READY on the Admin and default
project aliases. The source archives were read back through Vercel: all four
agent/acquisition runtime files match the tested foundation, including the
MAIN_ADMIN-only, seven-day and pending-reschedule safeguards. The concurrent
catalogue release is preserved. All 128 focused fixtures, 40 disposable
PostgreSQL checks, focused lint, TypeScript and isolated production builds
pass; TypeScript also passes after matching the concurrent catalogue source.
Five live agent cases return 503 with no-store; Admin home returns 200 and
its unauthenticated API returns 401. Public HEAD checks pass without bypass.
The SQL candidate remains local, no connector or live acquisition emitter
was enabled, and the wider rollout stays paused with FAILED_GATE unchanged.
The exact source hashes, deployment sequence, two omitted schema-test source
artifacts, verification scope and existing failures are recorded in
`evidence/AGENT_FOUNDATION_DEPLOYMENT_20261003.json` and
`evidence/agent-foundation-deployment-20261003/`.

The subsequent user-authorized 2026-10-03 agent-summary source release is
published as Admin `dpl_87K1ScSv97w5aBRuhYr6V39nZkpW`, READY and serving
`admin.bookingtours.co.za`. It changes only `app/lib/agent-tools.ts` and
`app/lib/agent-read-service.ts` for per-person waiver counts and explicit
payment booking units; the other 447 runtime files match the previous live
release `dpl_7Gy8PAtiUue5QERVdTkEWR29eZJS`. All 155 focused fixtures,
whole-application TypeScript, focused lint and the cloud production build pass.
Candidate agent GET/POST return 503 with no-store. Public checks without
bypass confirm Admin 200, agent `503 INTEGRATION_DISABLED` with no-store and
the unauthenticated Admin API 401. The live deployment ID was verified after
promotion. The participant aggregate SQL remains local and outside the
migration ledger; no SQL was uploaded or applied. The service has no production
caller and external agent access remains disabled. The traveller storefront
was already current and required no new deployment. Evidence and source
manifests are in `evidence/AGENT_PARTICIPANT_DEPLOYMENT_20261003.json` and
`evidence/agent-participant-deployment-20261003/`. The broader rollout remains
paused and `FAILED_GATE` is unchanged.

The user's subsequent 2026-10-03 request, “please deploy everything beside the
agent service update”, is complete on the specified Kayak domains. Admin
`dpl_5K9GzkGeVe3ChTZdCZdQWh7acw2n` serves
`https://kayak.admin.bookingtours.co.za/`; booking
`dpl_7CVfGAyig6kjNGGTXf5qaYiX8kDC` serves
`https://kayak.booking.bookingtours.co.za/`. Both aliases resolve to READY
releases. Uploaded source archives match all 458 Admin and 169 booking files
in the tested packages. The existing deployed agent service is preserved
exactly; its newer trusted-provider-binding update remains local and excluded.

This explicitly authorised deployment exception also applies migration
`20261003160000_agent_read_foundation` and publishes `create-checkout` version
106, `web-chat` version 148 and `wa-webhook` version 237. The webhook retains
its live entry point and changes the shared pricing helper. The new grant
table has RLS, no anonymous reads or authenticated writes, disabled defaults
and zero grants. Both aggregate/observation functions remain STABLE SECURITY
INVOKER with anonymous execution revoked. No connector or consent flow is
enabled; the agent HTTP route remains closed.

Validation includes 1,737 passing unit fixtures with one intentional skip,
Admin/booking TypeScript and repository lint, three Edge checks, 76 disposable
PostgreSQL checks, a rolled-back production migration rehearsal, 27 custom
question browser cases and 27 chat browser cases. All 24 booking guest cases
pass across the completed suite and its corrected cold-build deep-link rerun.
All 14 responsive Admin cases pass against the actual production build in
Chrome and Safari with mocked Auth/data; Safari's local development preview
stalls were not reproduced in that build. Nine public tenant browser cases
pass across desktop Chrome, phone Chrome and phone Safari. Public requests
without bypass confirm both Kayak homes return 200, the agent endpoint returns
503 with no-store and the unauthenticated Admin API returns 401. No customer
booking, provider payment or message was submitted by these checks. Evidence
and current source hashes are in
`evidence/ALL_EXCEPT_AGENT_SERVICE_DEPLOYMENT_20261003.json` and
`evidence/all-except-agent-service-20261003/`. This exception does not resume
load/provider qualification or change PAUSED_BY_USER / FAILED_GATE.


The owner requested “please deploy allchanges” on 4 October 2026. This source release is published: Admin dpl_EhJYZbZS9hY5sZHKo28sMxq2eXSw, booking dpl_E1NoUXrNb99uxSKupRksTbYtbh15, and the marketing Firebase version 1dc4eb9152d16f13. Web chat is version 149 and WhatsApp is version 238; their downloaded source matches the tested package. Dashboard help version 19 and checkout version 106 were already current. Both cloud builds, the static build, 51 synthetic guest-chat browser cases, 24 marketing browser routes and 14 public HTTP checks pass. All 135 marketing sitemap pages return 200 with valid schema/visible FAQs and normalized canonical identity; the three excluded/missing routes return 404. Production dependency audits are clear. Seven high build-tool findings remain in each application build chain. No native customer booking/payment/message was submitted by verification. Agent runtime is deployed but closed; the new schema, gateway credential and isolated staging/provider journey remain pending. No migration or enablement occurred, and PAUSED_BY_USER / FAILED_GATE is unchanged. Exact scope and evidence are in evidence/ALL_CHANGES_DEPLOYMENT_20261004.json.


The reported Wednesday/06:00 web-chat conversation is fixed and published on 5 October 2026 as web-chat version 150. The booking flow now recognizes requests phrased as “get me a booking”, retains the requested date and time, and handles schedule corrections before collecting further details or confirming checkout. Unavailable dates and times are explained and alternatives require the guest’s choice. Validation covers 450 targeted unit cases and all 60 browser cases (59 in the complete run, plus the unchanged IME case passing on a focused rerun after a local connection reset), including nine exact conversation cases across desktop Chrome, mobile Chrome and mobile Safari. The downloaded 16-file function bundle exactly matches the tested package; only web-chat/index.ts differs from version 149. No migration, booking, payment or customer message was submitted by verification. The broader PAUSED_BY_USER / FAILED_GATE remains unchanged. Evidence: evidence/WEB_CHAT_REQUESTED_SCHEDULE_20261005.json.


The owner requested deployment of all changes made on 8 October 2026. Admin
deployment `dpl_9sDQ5vztJayELXWVJ64SP5eP4ZcP` is READY and serves
`admin.bookingtours.co.za`. The release preserves the previous production source
`dpl_F3pqbpucFqNR4sypXrGbgaRJsXvT` and updates eight runtime files for Reviews
inside Reports, specific-date and range tour schedules, calendar positioning,
and the responsive help-chat panel. All 439 uploaded source files match the
release snapshot. The production build, TypeScript, 2,097 unit tests, eight
public HTTP checks, and deployed browser checks pass. Browser checks cover
320–1440px layouts, report navigation and moderation, staff/demo permissions,
help and calendar placement, and tour date controls using isolated fixture data.
The Reports and Settings help articles are synced: five sections updated, 160
unchanged, and zero failures or removals. No migration, Edge function change,
customer booking, payment, or message was submitted by this release. The wider
PAUSED_BY_USER / FAILED_GATE remains unchanged. Evidence and source manifests
are in `evidence/TODAYS_CHANGES_DEPLOYMENT_20261008.json` and
`evidence/todays-changes-deployment-20261008/`.


The owner requested deployment of all changes made on 15 October 2026 and repeatedly
authorized continuation. The verified 16:33 SAST snapshot is published as Admin
`dpl_6dmkz7W8U4wj9MQLNSgcGj8dhwMB` at `admin.bookingtours.co.za`. All 463 uploaded
source files match the tested snapshot. Nine migrations were rehearsed against
production in a rolled-back transaction, then committed and verified against their
exact sources. Ten payment/marketing functions are ACTIVE with their expected
versions and JWT settings; all unrelated function versions are unchanged.

The release covers payment recovery/email and paid outcomes, direct WhatsApp
contact, returning-customer history, configurable WhatsApp discounts, welcome-back
email drafts, marketing permission/delivery/revision controls, shared operator
manifests and arrival approvals, atomic walk-in bookings and participant questions,
and confirmed-unpaid accounting/cancellation corrections. Automatic welcome-back
and affected promotional sends remain held; no policy or consent approval was
invented. Resend callback provider/signing-secret setup remains pending and the
endpoint safely refuses unconfigured callbacks.

The final focused suite passes 427 tests. Five deployed browser cases pass with
mocked Auth/customer/provider calls. The operator evidence records seven synthetic
browser cases and 16 disposable PostgreSQL acceptance groups. TypeScript, ten Deno
entrypoint checks, cloud production build and migration/RLS/grant checks pass. Four
help articles were synced: nine chunks updated, 160 retained, no removals/failures.
No real customer booking/payment/message was submitted by verification. The booking
storefront is unchanged. PAUSED_BY_USER / FAILED_GATE and dormant agent/OTA
boundaries remain unchanged. Preserve the new promotional gates and audit tables
on rollback. Concurrent shared working files were preserved; the exact deployed
runtime differences and migration sources are retained in
`evidence/todays-changes-deployment-20261015/`. Release record:
`evidence/TODAYS_CHANGES_DEPLOYMENT_20261015.json`.


On 16 October 2026 the owner asked what could be completed on BookingTours'
behalf for marketing setup. The scoped diagnostic improvement is published as
Admin `dpl_BUdA5CF8mUHjAtj1h4L7qHWwPZwT`, preserving the verified 15 October
all-changes baseline `dpl_749ZGg63mBwEQ4zfdG8bdWUPEuCZ`. All 482 uploaded files
match the release package. The new service-only `marketing-setup-status` version 1
only reads configuration flags and the selected operator's delivery-policy reason.
The verified Admin API binds that operator to its caller. The UI names actual
remaining setup tasks, offers retry for failed checks, and includes the operator
and tasks in a support email draft. Admin help version 23 and ten marketing
knowledge chunks reflect the change. Hosted source checks cover all 12 bundled
files across the two functions; an internal live help answer passes. Forty-two
focused unit tests, eight local browser checks, three deployed synthetic browser
checks, four live HTTP checks, TypeScript, ESLint and both Edge type checks pass.

The email API/sender variable names exist, but the feedback signing secret is
missing and zero operator delivery policies are enabled. These are diagnostics,
not activation approval. No Resend account/DNS/provider configuration, secret,
permission, offer or sending policy was changed and no customer message was sent.
Welcome-back automation remains unfinished and held. The broader rollout pause
and dormant integration boundaries remain unchanged. Evidence and the remaining
account/engineering work are in `evidence/MARKETING_SETUP_DEPLOYMENT_20261016.json`
and `../marketing/EMAIL_ENABLEMENT_20261016.md`.


On 16 October 2026 the owner requested the full Photos tools and existing
photo/thank-you sending flow for shared Simple View guides, plus the button label
“Send photos and thank you email”. This scoped update is published as Admin
`dpl_HCaW5dys6U1GsJ9ueSpEZY6hQ3qQ`. The main Photos page and guide departure
photo route reuse one workspace, including image/video uploads, manual/bulk links,
recent history, retries and delivery results. A guide's confirmed action uses the
existing TRIP_PHOTOS email and WhatsApp templates for eligible lead bookers of its
own operator. Guide Google credentials remain server-side; upload URLs are bound
to a single file in a signed operator/trip/folder scope. No migration was needed.
The newer guide-login/sign-out fix `dpl_3ELT2erzNJAya63VE6U35WhbH125` was preserved
with exact source hashes. All 486 uploaded source files match the final package.
Native help version 26 and 16 help chunks (three articles plus one scoped Settings
section) are verified. The full unit run passed 2,390 cases with 58 intentional
skips; 50 focused cases, five final local and five final deployed synthetic browser
cases, TypeScript, the production build, three zero-row schema checks and seven
live access checks pass. Mobile contrast and the shared guide photo actions were
visually reviewed. No real upload, customer email, WhatsApp message, booking or
payment was submitted by verification. Existing Google Drive connection and
provider rules apply. Marketing/welcome-back activation and the broader rollout
pause remain unchanged. Exact scope, corrections and evidence are in
`evidence/GUIDE_PHOTOS_DEPLOYMENT_20261016.json`.

On 16 October 2026 the owner requested deployment of all today's changes. The
remaining working changes are published as Admin
`dpl_HyUe8UGUfYHyrdDrVCCRQB4czYVS`, preserving the complete guide Photos and
guide-login release. All 486 uploaded Admin files match the prepared source;
the guest booking site's 169 files already match production and required no
redeployment. Operator owners use normal sign-in for banking and integration
settings, with role, tenant, account-status and audit checks retained. Platform
SUPER_ADMIN MFA remains enforced. Web chat now resolves the same saved automatic
discount rules as WhatsApp at quote, customer-details and checkout stages.
Marketing sequence suggestions live under Automations, vouchers use the shared
page hierarchy, and Data Requests appears at the bottom of Settings.

Native `admin-help-chat` version 27, `bank-details` version 29,
`onboarding-wizard` version 12 and `web-chat` version 152 are verified across all
30 bundled files. Existing JWT gateway settings are preserved; other functions
are unchanged. The three changed knowledge sections were synced, and three
internal live help answers pass. All 2,390 unit cases, TypeScript, four Edge type
checks, the production build, eight marketing browser cases, one operator-settings
browser case, five deployed guide-photo browser cases and ten live HTTP/access
checks pass. There are 58 intentional unit skips and 14 ESLint warnings, with no
ESLint errors. No new migration or real customer/provider action was performed.
Marketing/welcome-back activation, external integration boundaries and the broad
rollout pause remain unchanged. Evidence:
`evidence/ALL_CHANGES_DEPLOYMENT_20261016.json`.

On 16 October 2026 the owner clarified that all MFA must be removed, including
SUPER_ADMIN. The previous release's retained Super Admin requirement was an
incorrect scope restriction and is superseded by Admin
`dpl_45o3HogLgGoNEsuQoQUXaE7nLxFx`. Settings, Super Admin onboarding, platform
banking and operator support no longer show or require authenticator enrollment,
QR codes or challenges. The shared server boundary still validates the signed-in
identity and role; account status, tenant/target binding, encryption and audited
setters remain. Legacy factor recovery is retired with HTTP 410. The old status
endpoint supports cached clients by reporting ready after identity verification.

Hosted TOTP enrollment and verification are now disabled. Phone and WebAuthn MFA
remain disabled; all unrelated authentication configuration is unchanged. No
existing factor records were deleted. Native bank-details version 30,
super-admin-onboard version 73 and admin-help-chat version 28 match all 12 bundled
source files; existing JWT gateway settings and unrelated functions are unchanged.
All 484 uploaded Admin source files match, with both authenticator components
absent. The full unit run passed 2,383 cases with 58 intentional skips; 50 focused
cases, TypeScript, three Edge checks, the production build, two local and two live
owner/Super Admin credential-save browser cases, ten live access checks and two
internal chatbot answers pass. The help knowledge retains 176 chunks, including
invoicing and monitoring guidance. No real credentials, payments or customer
messages were changed by verification. Evidence:
`evidence/MFA_REMOVAL_DEPLOYMENT_20261016.json`.

On 16 October 2026 the owner asked that WhatsApp and Call in Simple View open in
a new tab. Admin `dpl_DV7xuxRfeemH3XhLj7jr3TvA4xPS` adds `target="_blank"` and
`rel="noopener noreferrer"` to the shared Call link; WhatsApp already had them.
This one-file change preserves the entire MFA-removal release. All 484 uploaded
source files match. Sixteen focused unit cases, ESLint, the production build,
ten live HTTP/access checks and a deployed synthetic browser check across Today,
Calendar and Check-ins pass. WhatsApp opens a mocked destination separately and
the original dashboard page remains open. Call targets are verified without
placing a call; the device may launch its configured calling app for `tel:`.
No backend, database or authentication configuration changed. Evidence:
`evidence/SIMPLE_CONTACT_TABS_DEPLOYMENT_20261016.json`.

On 16 October 2026 the owner reported that Guide Simple View replaced operator
logins in other tabs. Admin `dpl_HmTU5CGaSLZkrD5ocFv8WTeB2vks` separates guide
Supabase sessions, browser metadata, advisory cookies, offline queue ownership
and worker registrations from operator sessions. Sign-out revokes only the
current session and guide sign-out leaves operator push alerts subscribed.
Guide photos now stay within `/simpleguide/photos/<departure-id>` and reuse
the complete Photos workspace. Guide and operator sign-in pages link to each
other. Old guide cookies no longer redirect every dashboard page. Existing
guide tabs require a refresh and new guide sign-in once. API role and tenant
checks remain unchanged; no MFA was reintroduced.

All 486 uploaded source files match the isolated release, preserving the prior
MFA removal and contact-link deployment. TypeScript, production build, 2,399
unit cases (58 existing skips), 15 live synthetic browser cases, a separate
Aonyx-dashboard plus central-guide multi-tab case, and ten live HTTP/access
checks passed. Both sign-out directions, refresh, photo tools, password setup
and partial arrivals were checked. The guide help section was updated and
175 other live knowledge chunks preserved. No customer credentials, messages,
provider writes, migrations or Edge deployments were used. Evidence:
`evidence/GUIDE_SESSION_ISOLATION_DEPLOYMENT_20261016.json`.


On 16 October 2026 the owner requested admin departure/capacity overrides and an
always-available bespoke Extra pax option, then authorized deployment. Admin
`dpl_7of8iQxrzBkWfvFKR6hiG9jyFm5S` publishes the two scoped form/component updates,
preserving all 484 other uploaded files from the guide-collapse baseline. Admins
can enter the date, time, adult/child counts and agreed total, including zero and
past departures, without the normal 50-guest limit. Existing full/closed departures
can receive the additional guests; bespoke departures remain closed to public
sales. Confirmed bookings appear on their departure date in the manifest and
Simple View. Required participant questions support paging beyond 50 guests.

Migration `20261016140000_admin_extra_pax` was rehearsed with rollback, committed,
and verified against all six function bodies, schema constraints and unchanged
RPC grants. Atomic request retry, exact totals, invoices, capacity preservation,
payment completion and role/tenant boundaries passed 21 local PostgreSQL
acceptance groups and the payment-recovery database suite. Sixty-five focused unit
cases, TypeScript, the hosted production build, four candidate and four live
synthetic browser cases and 11 live HTTP/access checks passed. Both changed help
entries were synced, preserving 175 others. No Edge function version changed;
the 169-file guest site already matched production. No real customer booking,
payment or message was submitted by verification. Marketing activation and the
broader rollout pause remain unchanged. Evidence:
`evidence/EXTRA_PAX_DEPLOYMENT_20261016.json`.


On 16 October 2026 the owner requested removal of the /simple/help link from
Simple View. Admin `dpl_HWyBwRqyZyRdz9DWw2fCk4sCBeEn` removes that destination and
its unused icon from SimpleViewShell, covering both desktop and phone navigation.
All 486 uploaded source files match the prepared release; the other 485 files
preserve the Extra pax deployment. ESLint, the production build with TypeScript,
a live synthetic browser case at 390/1024/1280 pixels and 11 HTTP/access checks
passed. No database or Edge function changes, customer actions or marketing
activation were performed. Evidence:
`evidence/SIMPLE_HELP_REMOVAL_DEPLOYMENT_20261016.json`.


On 17 October 2026 admin deployment `dpl_3xJNNVaSHyEGCRgYx6ihPGQ4Rf4P` fixed
guide Drive uploads incorrectly reporting failure after Google stored the files.
The server now sets the website Origin when creating the resumable session, so
the browser can read Google's final response. The workspace confirms a file ID
and shows a useful failure reason while preserving failed selections for retry.
Only photo-session/route.ts and TripPhotosWorkspace.tsx changed; all 484 other
uploaded sources preserve the Help-removal deployment.

An actual browser-to-Drive probe reproduced failure without Origin and success
with Origin; both disposable test files were removed. The owner's original four
files already existed in three retry folders with identical checksums. One
verified existing folder link was restored to the reported departure with the
shared guide attribution. Original files and duplicate folders were untouched;
no customer messages were sent. Seventeen unit tests, seven local and seven live
synthetic browser cases, the production build with TypeScript, 486 source hashes
and eleven live HTTP/access checks passed. ESLint had no errors and four existing
warnings. No database schema or Edge functions changed. Evidence:
`evidence/GUIDE_UPLOAD_FIX_DEPLOYMENT_20261017.json`.


The owner authorized deployment of all current changes on 2026-10-17. Admin
`dpl_3u134cjqjn3x7at3YiEEvRbVkH1p` is READY on the production domains. Its
488 uploaded source files were verified against the prepared workspace snapshot,
preserving the deployed guide photo-upload fix. This release includes the
integration-removal controls and remaining dashboard, roll-call, guide and
booking-form changes. Migration `20261017120000_clear_integration_credentials`
is applied; its audited setter is service-role-only and preserves payment mode.
The remaining Edge source updates are published as billing-enforcement v12,
confirm-booking v80 and manual-mark-paid v82, with their authentication settings
preserved. All other function versions remain unchanged. Nine help sections were
updated and all 177 knowledge chunks verified. The guest booking site's 169
source files already match production, so its existing deployment was retained.
Production build and TypeScript, 2,434 unit tests, nine hosted browser cases and
eight live HTTP/access checks pass. Browser identities and operational data were
simulated; verification changed no customer bookings, credentials or payments
and sent no customer messages. The broader qualification pause and FAILED_GATE
remain unchanged. Evidence is in `evidence/ALL_CHANGES_DEPLOYMENT_20261017.json`.


On 18 October 2026 the owner requested the normal desktop booking layout on
all desktop widths. Admin `dpl_ATUtJHejxdaatHqiCFbGEgggeTaQ` is READY on the
production domains. Both `/bookings` and `/simple/bookings` now use the existing
desktop table from 1024 pixels, matching desktop navigation, and retain cards
below that width. The phone action sheet stays within the viewport, scrolls
independently and restores keyboard focus; changing layouts closes open actions.
Only `app/bookings/page.tsx` changed in the deployed source; all 488 uploaded
sources were verified and the other 487 files preserved the preceding release.
Production build and TypeScript, eight focused unit tests, three Chrome and two
WebKit hosted browser cases, and four live HTTP checks passed. Desktop widths
1024/1280/1440/1920 and five phone/tablet sizes were covered. ESLint reported no
errors and seven existing warnings. Browser identities and bookings were
simulated; no customer booking, payment, message or configuration was changed.
No database or Edge function changes were made. The broader qualification pause
and FAILED_GATE remain unchanged. Evidence:
`evidence/DESKTOP_BOOKINGS_DEPLOYMENT_20261018.json`.


On 18 October 2026 the owner requested deployment of all changes made today.
Admin `dpl_BnQsYQsx6G8bi4p9wQPBCf1gDQHh` and booking
`dpl_6mkaQSQVq2XvqUAotEBgEkcfJ7uk` are READY and promoted to their production
domains. The release includes the admin accessibility and layout refinements,
booking review, collapsible departures, customer menu/dialog/review changes,
and preserves the already deployed desktop booking table and guest-action fix.
The marketing-unsubscribe function was deployed with its existing JWT setting;
all three Edge source files match, and unrelated functions are unchanged.
All 657 uploaded web source files were verified against the release snapshot.
Both production builds and TypeScript, 2,434 unit tests, Edge type checking,
10 hosted browser cases, live sign-in/menu browser checks, and 14 HTTP/access
checks passed. ESLint reported zero errors and 27 warnings. Three stale test
fixture assumptions were corrected during verification. No database migration
was applied, and no real customer booking, payment, message or unsubscribe was
performed by verification. The broader qualification pause and FAILED_GATE
remain unchanged. Evidence: `evidence/ALL_CHANGES_DEPLOYMENT_20261018.json`.


On 19 October 2026 the owner authorized the admin contact deployment. Admin
`dpl_EPVCgC5T3JdAZ3CEoh4bmKktyCBo` is live at `admin.bookingtours.co.za`.
Main Admin and Super Admin can edit administrator names, email addresses and
optional phone numbers within their existing role and operator boundaries.
Linked sign-in emails stay synchronized; duplicate emails, stale edits and
active password-setup claims are rejected, and old setup links expire when
an email changes. Migration `20261019110000_admin_contact_details` was rehearsed,
applied and verified, including unchanged table grants and REST schema visibility.
The isolated release changes five runtime files and preserves all 491 unrelated
source files from the previous production release. The build, 144 focused unit
tests, disposable PostgreSQL checks, eight hosted synthetic browser cases and
five live HTTP/access checks pass. Two help sections were updated and 176 retained.
No real administrator contact was changed during verification. The broader
rollout remains paused. Evidence: `evidence/ADMIN_CONTACT_DEPLOYMENT_20261019.json`.


On 20 October 2026 the owner's requested marketing restoration is live in admin
`dpl_5kkZGSKTP5rTJUdeUnHeDGjzXVx5`. The release preserves all 492 unrelated sources,
including the concurrently deployed partnership and booking changes. The existing
Resend connection and verified bookingtours.co.za domain were reused; the enabled
bounce/complaint/suppression callback and its signing secret are configured. The
temporary service-only provider management function was removed. All four active
operators have sending enabled with existing 08:00–20:00 local hours and a shared
24-hour contact limit; the suspended platform account remains excluded.
Migration `20261020040000_marketing_readiness` was rehearsed, applied and verified.
Main Admin/Super Admin can record actual consent evidence in contact history.
Email-only welcome-back sequences use verified paid history, recheck refunds,
newer and upcoming reservations, avoid repeated enrollment, and preserve opt-outs.
Early provider callbacks are retained and matched to stored send addresses.
The unique migration version avoids a concurrently applied partnership migration;
no existing migration was overwritten. Marketing status and help functions were
updated from exact live sources, with all other function code preserved.
The build, TypeScript, 80 focused tests, disposable PostgreSQL regression checks,
Edge type checks, six staged and six live synthetic browser cases, five HTTP/access
checks and readiness checks for all four operators passed. Ten marketing help
chunks match the source, with 168 other chunks preserved (four re-embedded).
No customer messages were sent by verification and no contact permission or draft
activation was manufactured. Actual recipient delivery was not tested. Automated
offer issuance, event-tag/date journeys and promotional test sends remain held.
The broader rollout pause is unchanged. Evidence:
`evidence/MARKETING_RESTORATION_20261020.json`.


On 20 October 2026 the owner requested removing the “Email your customers”
section and contact-permission count from Marketing. Admin
`dpl_778XJ2zdJiXacCXcKaPrQ7ij43vM` is live. Only `app/marketing/page.tsx`
changes at runtime; the other 498 deployed sources are preserved. The section,
its state and two unused data requests are removed. Existing browser expectations
were updated. The production build, TypeScript, clean scoped lint, two staged
and two live synthetic browser checks at 390/1280 pixels and live HTTP check
passed. No database, Edge function or customer data changed. The broader pause
remains unchanged. Evidence: `evidence/MARKETING_OVERVIEW_REMOVAL_20261020.json`.


All pending workspace runtime changes were deployed on 2026-10-20 as Admin `dpl_EDKqqDjiSeqtd3tQB5qcjgwuf8tP`, now serving `admin.bookingtours.co.za`. All 503 uploaded source files match the tested snapshot. The booking site `dpl_Dpckn5CgwuCnh68G2hQxE4E1fp2c` already matched all 171 current source files and needed no redeployment. Five pending Edge Functions were deployed and their sources and authentication settings verified. The promotional-email sender rollback is preserved. All 2,540 unit tests pass with 58 intentional skips, all 58 Edge Function type checks pass, the Admin production build passes, 43 responsive page cases and six hosted browser cases pass, and 12 live HTTP checks pass. Nine dashboard-help sections were synced. No recent migrations were missing, and no database migration or real customer action was performed. The broader qualification status is unchanged. Evidence: `evidence/ALL_CHANGES_DEPLOYMENT_20261020.json`.
