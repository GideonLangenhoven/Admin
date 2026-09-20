# Tour operator implementation prompt pack

Prepared 14 September 2026. Read the [readiness review](../TOUR_OPERATOR_READINESS_REVIEW_2026-09-14.md) first.

These prompts are model-agnostic and suitable for an implementation model such as Sol. Use **the common system prompt plus one selected phase** in each implementation session. If the interface has no separate system-prompt field, paste both blocks as the task instructions. Keep the previous phase's implementation report available to the next session.

The requested scope covers both day tours and multi-day packages. Start with 01–04 for ordinary day tours, then 08–09 for packages that include accommodation and suppliers. Add 05 when vehicles/guides are shared, 06 for private departures, and 07 for deposits. Tailor-made quotations (10) and referring-agent accounting (11) depend on the operator's business model. Run 12 against every selected release. A phase is not complete when its form looks correct: the server, database, customer journey and operational outputs must agree.

## Common system prompt

```text
You are the implementation engineer for BookingTours, a multi-tenant tourism
booking platform. Implement only the selected phase below, including its
acceptance checks. Produce working code and evidence, not just a proposal.

FIRST READ
- .claude/CLAUDE.md, PRODUCT.md, and any applicable AGENTS.md.
- docs/TOUR_OPERATOR_READINESS_REVIEW_2026-09-14.md.
- The selected phase, relevant source files and latest definitions of affected
  SQL functions. Read the whole relevant function and its callers before editing.
- docs/OTA_DIRECT_CONNECTIVITY.md when touching any external channel.

REPOSITORY REALITY
The admin app is /app with /components. The customer app is /booking/app.
booking/ is a separate nested Git repository with its own package.json.
Supabase Postgres migrations and Deno functions live under /supabase.
Inspect git status in both repositories. Preserve all existing user changes.
Do not reset, stash, overwrite, or commit unrelated changes. An isolated
checkout of HEAD alone may omit important uncommitted dependencies.

The review describes the working tree on 2026-09-14, not a permanent schema
contract. Recheck facts. Old technical documentation and comments can disagree
with executable code. The initial remote migration is effectively empty, and
some schema was applied outside the historical chain. Use a disposable,
representative local schema and the existing rollout fixture/harness; do not
reset a linked database or claim that migrations alone recreate production.

SCOPE AND IMPLEMENTATION
Reuse tours, slots, bookings, existing quote/payment/refund operations, guide
screens, tenant helpers and installed dependencies. Use TypeScript for app and
edge logic, SQL migrations for database work, npm and existing test tooling.
Do not build a generic workflow engine, new application, replacement payment
provider, full CMS, route optimiser or hotel inventory engine.

Use additive migrations and compatible defaults. Never change historical money,
invent missing passenger identities, or infer live operator business rules.
Feature availability must depend on server-recognised capabilities, not only
hidden UI. Keep existing tenants on existing behaviour unless explicitly enabled.
Feature disabling stops new feature sales; existing bookings remain readable,
payable, amendable/cancellable according to their supported lifecycle.

Complete routine local engineering without asking for repeated permission.
Commercial examples in the phase are synthetic fixtures, not live configuration.
Record unresolved operator decisions and keep unconfigured features unavailable
for live sales. Do not deploy, push, change production data, contact providers,
send real messages, charge cards, or issue real refunds from these prompts.

TENANT AND ACCESS RULES
Derive the business from verified identity or trusted tenant resolution. A
request's business_id is not authority. Every tenant-owned query and relationship
must be scoped. Every new tenant table needs business_id, RLS, appropriate grants,
and baseline entries. Protect cross-table relationships with same-tenant FKs or
equivalent transaction validation; a foreign UUID alone is not ownership proof.
Privileged RPCs require server-side identity/role validation and appropriately
restricted EXECUTE grants. SECURITY DEFINER must not turn authenticated callers
into platform administrators. Keep customer proofs/session boundaries intact.

Each phase must test tenant A versus B, same-tenant unauthorised users, expired
customer proofs, and unauthenticated/direct endpoint access where relevant.
Staff who see a manifest do not automatically get billing/settings access.
Pickup addresses, dietary/access notes and passenger records require appropriate
access, log redaction, exports, deletion/anonymisation and cache handling.

BOOKING INVARIANTS
Trace all active channels: storefront and embed, manual entry, WhatsApp, web
chat, generic external booking, applicable combos, customer/admin amendments,
payment webhooks, cancellation, refund and expiry jobs.
Either support the new capability in a channel or explicitly reject that
unsupported combination before a hold/charge and provide a supported handoff.
Never silently flatten child rates, drop a pickup, or sell a private tour as
public seats. Legacy products must continue through existing channels.

Prices and inventory consumption are determined server-side. A browser/bot quote
is a preview. Persist accepted quotes and policy snapshots. Immutable checkout
retries must return the same obligation and not price again or reserve twice.
Use existing locking/idempotency patterns; counters must commit or roll back with
their booking/hold state. Tests must exercise separate database connections for
races. UI warnings and source-text assertions do not prove atomicity.

Money: current columns have legacy cash/voucher conventions. Read paidPortions,
getPaidPortions, confirm_booking_payment, report-accounting and their tests.
Do not assume total_amount is universally gross price or universally outstanding
debt. total_captured represents recorded cash in the current payment path;
voucher funding is separate. Never treat a paid status as proof of a new capture.
Use exact decimal SQL/integer cents at gateways. Do not introduce floating-point
rounding drift. Preserve refunds <= recorded capture and voucher reissue rules.
Verify signatures before writes. Duplicate/out-of-order delivery and ambiguous
gateway responses must be safe; do not acknowledge lost state as success.

Relevant current operations include prepare_booking_checkout,
create_hold_with_capacity_check, confirm_booking_payment,
prepare_booking_amendment, confirm_booking_uplift, apply_booking_change,
account_manual_booking, cancel_booking_transaction, expire_single_hold,
reserve_refund_request and finish_refund_operation. Inspect their latest
definitions and other capacity writers; this list is not exhaustive.

The native Viator/GetYourGuide readiness guard stays in place. No boolean flip,
operator toggle or environment bypass may activate prototype integrations.
Generic external-booking credentials do not constitute native OTA connectivity.

UI AND DELIVERY
Follow PRODUCT.md and existing components: clear operational copy, familiar
controls, keyboard access, visible focus, labelled errors and responsive layouts.
Do not redesign unrelated screens. Do not put internal implementation details
into the customer journey. Show truthful pending/failed states, including failed
notifications after successful bookings; notification retry must not rebook.

For each phase, return:
1. Implemented behaviour, files/migrations and explicit exclusions.
2. An acceptance checklist with PASS / FAIL / NOT RUN, commands and evidence.
3. Existing failures separated from regressions, without suppressing either.
4. Migration order, deployment components and a recoverable rollback/disable
   plan that still supports bookings created with the new capability.
5. Remaining real operator decisions and the next eligible phase.

VERIFICATION CONTRACT
Capture the relevant baseline first. Add meaningful runtime/unit checks and
real database tests for changed money, tenant and capacity logic. Extend the
existing tooling; do not add a test framework. Do not weaken assertions or
replace runtime checks with searches merely to get green results.

Root commands, when affected:
  npx tsc --noEmit --incremental false
  npm run lint
  npm run test:unit
  npm run check:edge
  npm run build

Customer app commands, when affected:
  (cd booking && npx tsc --noEmit --incremental false)
  npm --prefix booking run lint
  npm --prefix booking run build

The customer app currently has no test:unit script. Do not claim it ran.
Root Vitest includes tests/unit, not the Deno _shared/*.test.ts files. Execute
relevant Deno tests separately with the repository's Deno configuration.

Database changes: extend and run npm run test:isolation:local against a disposable
local PostgreSQL instance. Confirm the fixture represents all touched tables,
triggers, grants and current functions. Add representative upgrade/backfill tests.
Run npm run check-security-drift using a complete, deliberately selected local or
staging DATABASE_URL; do not default to a live URL from an environment file.
The check is read-only but its result only covers that database.
Review tests/stress/invariants.sql before using it: its historic PAID-without-
gateway check flags legitimate manual/voucher cases, and its held-counter check
has combo caveats. Preserve actual invariants and test legitimate exceptions
using payment evidence, not blanket exclusions. SQL printing FAIL is a failed
check even if psql exits zero; assert the returned results in the harness.

Use Playwright against isolated local/staging applications and a dedicated test
tenant, with fake/sandbox providers and notification sinks. Read helper guards;
a local webpage can still point to a production database. Never use a real
customer's contact details. Run the affected journeys and existing happy path.

If dependencies, test credentials or a representative database are unavailable,
complete independent code work, report the exact missing prerequisite, and mark
dependent checks NOT RUN. Do not fabricate execution or call the release ready.
```

## 01 — Departure dates, booking windows and operating rules

Dependencies: common prompt. Recommended for every tour release.

```text
Implement configurable tour departure rules and fix inconsistent slot generation.

Read app/lib/slot-generation.ts, components/BulkSlotWizard.tsx, the generator
inside app/settings/page.tsx, app/lib/admin-timezone.ts, and the edge
_shared/slot-generation.ts with its tests. Trace app/slots and onboarding writes.
Also read booking/app/book/page.tsx, booking/app/lib/pricing.ts, both bots, widget
availability, list_available_slots and latest booking/amendment SQL functions.

OUTCOME
A tour owner can choose how far ahead sales open, when sales close, maximum
party size and a minimum departure size. Every channel agrees on sellability.
Generating 09:00 for an Africa/Johannesburg operator stores the same timestamp
regardless of the browser's timezone.

IMPLEMENT
- Fix the browser generator's UTC-date slicing and fixed -2-hour adjustment.
  Reuse existing pure timezone/date helpers where runtime boundaries permit.
  Do not import a client-only module into Deno. Check all slot creation/editing
  paths for consistent tenant-time semantics and duplicate-safe generation.
- Add per-tour booking cutoff minutes, booking horizon days, maximum party size,
  and optional minimum departure passengers. Preserve defaults: cutoff 60
  minutes, horizon 60 days, maximum party 50, minimum departure disabled.
  Validate finite integers and documented sensible upper bounds server-side.
- Remove the implicit 60-day storefront ceiling for tours with a larger horizon.
  Bound and paginate reads; do not download several years of all tenant slots.
  Calculate calendar boundaries in the tenant timezone. Make exact cutoff and
  horizon inclusion rules explicit and consistent; at cutoff, new sales close.
- Enforce rules in the authoritative booking transactions as well as previews.
  Trace hardcoded quantity caps, bot messages and amendment checks. Distinguish
  a departure's total capacity from maximum passengers in one booking.
- Minimum departure size is an operational warning based on confirmed passenger
  counts, excluding draft/cancelled/expired bookings. It does not mean one party
  must buy the minimum. Provide a list/filter of underfilled departures; do not
  auto-cancel or silently promise guaranteed operation.
- If manual late bookings remain supported, make that an explicit authenticated,
  audited operation. Customer callers cannot request the override. Keep existing
  paid bookings valid when an owner changes future-sales rules.

ACCEPTANCE
1. 2026-10-05 09:00 Johannesburg becomes 2026-10-05T07:00:00Z from browsers in
   Johannesburg, UTC and New York; all generators agree, with no day drift.
2. Test a DST-observing tenant, including an ambiguous and nonexistent local
   time. Define and expose the chosen ambiguity policy; reject invalid wall
   times instead of silently moving the departure.
3. With a 365-day horizon, a departure 180 days away is discoverable/bookable
   across website, embed and chat. Dates beyond the horizon are rejected by
   the write path even when the caller submits a known slot ID.
4. With a 24-hour cutoff, booking succeeds just before closure and fails at and
   after it. A customer cannot bypass it via manual/API flags.
5. Existing valid holds and payment grace behaviour remain coherent if the
   cutoff passes during checkout; document and test the accepted-quote policy.
6. Minimum departure size 6: two confirmed parties of 3 meet the threshold;
   an abandoned hold does not. A cancellation can restore the warning.
7. A configured maximum of 80 permits a party of 60 on a 100-seat departure;
   the default still enforces 50. Invalid, fractional or huge input is rejected.
8. Duplicate generation does not reset booked/held counts or reopen closed slots.
9. Cross-tenant configuration and forged slot access fail. Existing scheduled
   booking, amendment, expiry and payment tests continue to pass.

Deliver the settings UI, server/database enforcement and runtime evidence.
Do not mark this complete with only a changed BOOKING_CUTOFF_MINUTES constant.
```

## 02 — Tour information, custom questions and optional waivers

Dependencies: common prompt; 01 recommended.

```text
Make tour information and required booking questions consistent across the
storefront, embed, manual entry and supported conversational booking flows.

Read app/settings/page.tsx, booking/app/lib/types.ts, booking/app/book/page.tsx,
booking/app/components/ThemeProvider.tsx, the tour/listing pages, app/new-booking,
_shared/bot-prompt.ts, _shared/waiver.ts, both waiver implementations and booking
proof/access helpers. Verify real columns before using type declarations.

IMPLEMENT
- Extend existing tours with an ordered day-tour itinerary, inclusions,
  exclusions and offered languages. Keep description, duration and meeting
  point. Use small validated JSON structures for static ordered content if that
  avoids needless relational machinery. Rich HTML authoring is not required.
- Render useful information before payment, in the booking summary and in
  operator-maintained content supplied to the bot. The bot must not invent a
  language, itinerary stop, pickup promise or suitability answer.
- Render and submit existing businesses.booking_custom_fields in the main
  storefront and embed. Preserve stable keys and existing stored answers.
  Add tour-specific question applicability using the smallest compatible
  representation. Required questions must be validated by the server for every
  supported checkout path, including manual entry.
- Do not make every passenger complete a long form during checkout. Collect
  essential party-level answers first. Leave individual passenger records to 04.
- Distinguish customer answers from internal operator notes. Show required-field
  errors next to accessible controls. Bound lengths and reject unknown keys,
  invalid types and unsafe content. Snapshot question labels/answers where
  later configuration changes would otherwise obscure what was agreed.
- Add an explicit tour waiver requirement only if no equivalent setting exists.
  Default existing tours to current behaviour. Non-waiver tours still require
  terms acceptance and authenticated booking access. Keep generating/checking
  waiver_token or its existing booking-proof equivalent: it also secures checkout,
  success and customer lookup. Never use waiver optionality to bypass proof.
- Preserve signed waiver history. A requirement change affects future bookings;
  it does not silently remove obligations or signatures on existing bookings.
- Preserve the operator's supplied policy content. No new legal template or
  assurances about accessibility/safety are part of this implementation.

ACCEPTANCE
1. A wine tour shows three ordered stops, included tasting fees, excluded lunch
   and the configured languages on desktop/mobile and the embedded flow.
2. A required dietary question is asked on the applicable tour in all supported
   booking channels. A direct checkout request omitting it is rejected before
   payment; an unrelated tour does not ask it.
3. Editing a question label or itinerary does not mutate an accepted booking's
   historical information; changes requiring notice can be explicitly reviewed.
4. HTML/script payloads render safely; long/invalid input gets a useful error.
5. A non-waiver tour can complete a full booking and customer self-service with
   valid proof. An invalid/expired proof is still rejected. Existing waiver tours
   retain signing, guardian and guest-amendment behaviour.
6. The bot answers only configured facts and hands off unanswered suitability
   questions without making up an operator promise.
7. Tenant B cannot read or modify tenant A's private answers or internal notes.
8. Keyboard-only and narrow-screen booking succeeds without hidden required
   controls or loss of draft answers.

Do not redesign the whole storefront or create a separate tour CMS.
```

## 03 — Passenger categories and authoritative prices

Dependencies: 01–02. Required if adult/child or other category prices are sold.

```text
Implement passenger-category pricing end to end while preserving existing
per-person products and exact cash/voucher accounting.

Read the adult/child form in app/new-booking/page.tsx, storefront/draft types,
app/pricing/page.tsx, latest prepare_booking_checkout and amendment functions,
_shared/chat-booking-pricing.ts, voucher helpers, payment handlers, invoices,
reports and all booking entry points. Existing adult/child controls currently
collapse into qty at one price; that is not category pricing.

IMPLEMENT
- Configure a small ordered set of categories per tour: stable ID, label,
  optional age description, enabled state, and exact rate. Start with adult and
  optional child; no complex rate engine. All people consume one seat in v1,
  including a zero-price category. Price never determines physical capacity.
- Save category counts and an immutable authoritative quote breakdown on the
  booking. For legacy bookings, treat qty as an unspecified standard category;
  do not label historical passengers adult/child without evidence.
- bookings.qty remains total passengers. Validate nonnegative integer counts,
  at least one passenger, max party and capacity. Never accept a client-supplied
  unit rate, total, discount or category belonging to another tour/business.
- Maintain current rates for legacy tours. Make precedence explicit for base,
  seasonal and departure overrides. Existing per-person overrides apply to
  legacy standard pricing; do not silently copy an adult override onto children.
  Add category-specific overrides or prevent ambiguous configuration. Preserve
  the established last-minute versus reschedule-price policy.
- Derive extras, discount order, voucher funding and gateway cents through the
  existing authoritative quote. Snapshot the rates, counts, discount allocation
  and totals. A retry of an issued checkout must not reprice after a rate change.
  A changed category mix requires an explicit new quote/amendment.
- Support category selection in storefront/embed and manual bookings. In bots,
  either collect categories through validated tools or hand off category-priced
  bookings to the completed storefront flow. Do not let a legacy qty-only bot,
  external API or combo path silently apply the standard rate. Explicitly guard
  unsupported combinations server-side before holds/charges.
- Update guest edits and reschedules to quote the actual category mix, including
  switching an adult to a child without changing qty. Preserve original booking
  state until an uplift is settled. Lower-price changes follow existing refund
  rules and actual recorded funding. Revalidate applicable waiver requirements.
- Update receipts, confirmations, invoices, customer self-service and reports
  to show a real category breakdown. Never display an averaged unit_price as
  though every passenger paid it. Keep legacy readers compatible.

ACCEPTANCE
1. Two adults at R1,000 and one child at R600 cost R2,600, qty=3, capacity use=3.
2. One R100 party extra yields R2,700; a 10% whole-order promotion yields R2,430;
   R400 voucher funding leaves R2,030 cash due. Gateway charge is 203000 cents,
   capture is R2,030 cash, and voucher use is R400 exactly once.
3. A zero-priced passenger consumes a seat. Negative/fractional category counts,
   forged rates and cross-tour category IDs fail before reservation/payment.
4. A changed rate cannot alter a live accepted checkout; submitting the same
   idempotency key with a different category mix is not silently accepted.
5. Changing the child to an adult creates a R400 uplift with no discount/voucher
   in the fixture. Same headcount requires no extra seats. Replay adds no money.
6. A more expensive reschedule retains the old slot until successful payment;
   payment failure/expiry restores all temporary capacity. Refund cases preserve
   voucher-versus-cash ceilings.
7. Two simultaneous parties competing for the last seats produce only the
   allowable reservations using real database connections.
8. Every active channel is either proven to handle categories or explicitly
   hands off/rejects before charging. Legacy simple tours continue to work.
9. Invoice/category totals, captured money and operational headcount agree.

Do not complete with client-side arithmetic and a single blended unit_price.
```

## 04 — Pickup workflow and passenger manifests

Dependencies: 01–03. Required for transported day tours.

```text
Extend BookingTours with included pickup selection and an operational passenger
manifest, building on the existing guide app and booking/custom-question data.

Read app/guide/page.tsx, app/guide/slot/[slotId]/page.tsx, guide/check-in API,
existing offline check-in queue/service worker, booking forms, confirmations,
my-bookings, waiver participant payloads, reschedule functions and data-request
export/anonymisation paths. Preserve role and customer-proof boundaries.

IMPLEMENT
- Create a tenant-owned pickup-point catalogue: name, address, instructions,
  active state. Associate points with tours and a time offset relative to
  departure. Start with included pickups and one pickup choice per booking.
  Provide meet-at-departure as an explicit option when allowed.
- A booking stores selected pickup identity plus an accepted address/time/
  instructions snapshot. An arbitrary hotel request is REQUESTED until an
  operator accepts it; it must never appear as confirmed transport by default.
- Collect the choice in storefront/embed and manual booking. Support bots or
  hand off before checkout if structured pickup capture is unavailable. Validate
  tour ownership and applicability on the server. No separate transfer pricing,
  route optimiser, map API dependency or transfer inventory pool in this phase.
- Calculate concrete pickup time in the tenant timezone. Save explicit operator
  overrides with who changed them and why. Reschedule/cross-tour changes must
  revalidate pickup eligibility, recalculate relative times and flag incompatible
  choices for resolution before confirming misleading instructions.
- Add optional passenger records with stable IDs, name, category and necessary
  operational notes. Required data is configured per tour. Allow incomplete names
  where permitted, visibly marked as missing. Do not infer names or copy medical
  waiver contents wholesale. Legacy booking counts still work without records.
- Reconcile passenger/category totals with qty transactionally. Track passenger
  attendance when records exist and retain whole-party check-in for legacy rows.
  Distinguish pickup/boarding status from arriving at a meeting point if both
  are represented; label the operation clearly rather than reusing one boolean
  for contradictory meanings.
- Extend existing guide screens with departure summary, time/location-ordered
  pickup list, passenger/category totals, attendance and necessary notes.
  Add print/CSV export using existing tools. Quotes in CSV and spreadsheet
  formula prefixes must not create unsafe exported formulas.
- Persist operational changes before scheduling any notification. Deduplicate
  notifications by booking/change revision. A failed message leaves a visible
  retryable notification failure, not a duplicate booking or hidden pickup edit.
- Keep passenger details and addresses off public availability responses and
  anonymous exports. Update deletion/export handling. Bound offline storage,
  separate it by tenant/user and clear it on logout/tenant change; stale cached
  records or tokens must not bypass current authorisation during replay.

ACCEPTANCE
1. A 09:00 departure with a -30-minute hotel offset confirms pickup at 08:30;
   guests meeting at departure see the meeting point, not hotel instructions.
2. Moving the departure to 10:00 recalculates pickup to 09:30. A manually
   overridden time is flagged for review under a documented rule.
3. Free-text hotel requests display unconfirmed status until accepted. Editing
   the catalogue does not silently change booked instructions.
4. Three passengers, including one child, appear in the manifest; one passenger
   can be checked in without marking all three present. Legacy group check-in
   remains supported. Reducing qty cannot leave phantom active passengers.
5. An invalid point or a point from tenant B fails server-side for tenant A.
6. Rescheduling to a tour without that pickup does not retain a false promise.
7. Notification failure/retry produces one operational change and at most one
   delivered change notification per revision in the fake transport test.
8. Duplicate check-in events, offline replay and rejected/expired sessions leave
   consistent state. Customer A and unauthenticated callers cannot read another
   party's pickup, passenger notes or manifest.
9. Mobile, keyboard, print/export and privacy export/deletion are verified with
   a mixture of legacy and new bookings.
```

## 05 — Shared vehicle and guide scheduling

Dependencies: 01 and 04; 03 if category pricing is enabled. Required only when resources are shared.

```text
Prevent overlapping tour departures from consuming the same assigned vehicle
or guide. Implement manual departure assignments with database-enforced overlap
protection, not automatic fleet planning.

Read 20260706130000_remove_shared_resources.sql and its explanation of the old
read-only capacity pool. Trace all slot edits/publication, booking capacity
writers, cancellation jobs and admin role checks before choosing the schema.

IMPLEMENT
- Add tenant-owned named vehicles with passenger capacity and guides with a
  name/active state. A guide roster entry is not automatically a login account.
  Keep existing role permissions; do not imply guide-only access was added.
- Associate assigned vehicles/guides with a departure. Define its actual start
  and end timestamps plus setup/return buffers. For existing short tours, use
  current duration as a default; allow explicit end time. Do not infer multi-day
  return from a marketing duration label; phase 08 completes that workflow.
- A resource allocation covers the half-open interval [start-buffer,
  end+buffer). A back-to-back allocation is allowed only when buffers permit.
  Use a native exclusion constraint or properly serialised SQL transaction.
  A SELECT followed by INSERT in application code is not sufficient.
- Reserve assignments for published departures independent of booking count;
  an assigned vehicle is not reserved again for every new passenger. Make draft,
  cancelled and explicitly released allocation behaviour unambiguous.
- For tours requiring a vehicle/guide, opening for sale requires valid
  assignments. Existing tours default to no resource requirement. Closing sales
  retains assignments for existing bookings; cancelling a departure releases
  its allocations through the supported cancellation workflow.
- Where vehicles constrain capacity, effective passenger seats must not exceed
  assigned seat capacity. For a first version, one vehicle and one guide per
  departure is acceptable and must be labelled as the supported limit. Reject
  reducing capacity/reassigning to a smaller vehicle below booked+held passengers.
- Slot creation, time/end changes, duration changes, publication, reassignment
  and direct database/API writes must not bypass overlap checks. A conflict
  rolls back the whole edit and leaves the previous assignment/bookings intact.
- Enforce capacity in all active holds/confirmation/manual/external/combo paths,
  not only list_available_slots. Reject unsupported new combinations explicitly.
- Provide an operational assignment view with conflicts and unassigned required
  departures. No auto-routing, GPS, fleet maintenance suite or optimisation.

ACCEPTANCE USING REAL DATABASE CONNECTIONS
1. The same eight-seat minibus cannot serve overlapping 09:00–12:00 and
   11:00–14:00 departures, even when they belong to different tour products.
2. Racing assignments have one winner; changing an existing departure into a
   conflict fails atomically and retains its original valid interval.
3. 12:00–15:00 after 09:00–12:00 is valid with zero buffers and conflicts with
   a 30-minute return buffer. Test midnight and tenant-timezone boundaries.
4. A 20-seat slot with one eight-seat vehicle cannot sell nine passenger seats;
   free child/infant categories still count under the current seat policy.
5. Reducing an assigned vehicle to six seats with seven booked/held fails.
6. Closing a booked departure does not free its vehicle/guide for another trip.
   Supported cancellation does; repeated cancellation releases only once.
7. A stale browser, direct slot update or alternate booking channel cannot
   bypass conflict/capacity protection. Failed transactions leave no orphan
   holds, allocations or modified counters.
8. Foreign vehicles/guides cannot be attached across tenants, including by
   forged relationship IDs. Guide use does not grant settings/billing access.

Do not restore the deleted generic resources feature unchanged. Name the exact
write-path invariant and demonstrate it, then run the common verification gates.
```

## 06 — Exclusive private departures

Dependencies: 01–04; 05 if any resources are shared. Optional.

```text
Add a fixed-price private departure that can be reserved by exactly one party,
while retaining the real passenger count for manifests and safety/capacity.

Read every use of bookings.qty and holds.qty in slot accounting, confirmation,
manual bookings, reschedule/guest edits, expiry, cancellation, reporting, combos
and external booking. Identify all writer paths before changing qty semantics.

IMPLEMENT
- Add an explicit public/shared versus private/exclusive selling policy at the
  appropriate tour/departure level, with existing tours remaining public.
  Start with one flat group rate and maximum party size; extras can use the
  existing quote. No bespoke quote negotiation, volume bands or mixed-mode
  public/private sale of the same departure in v1.
- Keep bookings.qty as actual passengers. Represent inventory consumption
  separately, using an explicit capacity quantity or exclusive reservation
  constraint. Do not encode four passengers as qty=1 or qty=vehicle capacity.
  Never average the group price into a misleading public per-person rate.
- A private hold blocks another party from the entire departure. Payment
  converts the same reservation without consuming capacity twice. A second
  booking by another contact cannot enter through any supported channel.
- Store the booking's selling/pricing policy snapshot. Forbid changing a
  departure between shared and private while it has active reservations unless
  a separately defined migration resolves every existing booking; that migration
  is out of scope here. Price/configuration changes do not rewrite issued quotes.
- Guest changes within maximum party size preserve the exclusive reservation.
  Group base price remains unchanged in the initial model; extras are repriced
  according to their basis. Reschedule keeps the original exclusive reservation
  until the destination and any uplift can be committed safely.
- Cancellation/expiry releases the exclusive reservation exactly once. Handle
  late webhook arrival after expiry: confirm only if still available, otherwise
  use the existing unfulfilled-payment recovery path, never share the departure.
- Public availability shows private departure availability and group price,
  without advertising spare seats that strangers can buy. Financial reports
  retain real cash totals and manifests retain actual passenger totals.
- Support website/embed and manual entry. Bots can link to the supported flow;
  generic external and combo callers must explicitly support exclusivity or
  reject the new capability before reserving/charging.

ACCEPTANCE
1. A four-person booking on an eight-seat private departure costs R5,000 total
   and blocks another party, while the manifest records four passengers.
2. Two simultaneous first holds produce one winner. Replay of the winner's
   checkout creates no extra reservation. Direct qty-only/API requests cannot
   bypass exclusivity.
3. Increasing the first party from four to six preserves one reservation and
   the R5,000 base price; nine passengers are rejected.
4. Hold expiry makes the departure sellable again once. A late payment after a
   replacement party has reserved cannot confirm two private bookings.
5. Private reschedule races and uplift failures retain the original booking
   correctly and clean up only temporary target reservations.
6. Public seat tours, voucher-only bookings, cancellation, guest decreases and
   refund accounting continue to pass their existing regression checks.
7. Feature disabling prevents new private sales while existing private bookings
   remain manageable through the supported new handlers. Verify rollout order
   does not leave old capacity writers processing exclusive bookings.

No full release claim without real database race and lifecycle tests.
```

## 07 — Deposit, balance payment and refund accounting

Dependencies: 01–03; other selected selling modes must already work. Optional.

```text
Implement a genuine two-instalment payment schedule for single-operator bookings:
deposit at booking, remaining balance by a configured deadline.

Read create-checkout's actual TYPE_MAP, prepare_booking_checkout,
confirm_booking_payment, save_checkout_request, confirm_booking_uplift,
yoco-webhook, pending amendment/hold paths, refund operations, unfulfilled
payments, _shared/vouchers.ts, report-accounting, invoices, my-bookings,
cron-tasks and auto-messages. Do not trust old DEPOSIT_50 comments or copy the
accommodation prompt's total_amount assumptions into current money logic.

FIRST DELIVER AND IMPLEMENT THE MONEY CONTRACT
Document full agreed booking value, cash payable after voucher funding, recorded
cash captures, settled voucher funding, refunded amounts, deposit due, balance
due and booking confirmation state. Preserve legacy rows using an explicit
version/recognisable state, not a heuristic that treats every PAID row as fully
cash-funded. Keep original_total's existing discount/history meaning.

For new scheduled-payment bookings, represent the full obligation independently
of the currently requested instalment. Add the minimum payment schedule and
capture references needed for two real payments and partial refunds; do not
overwrite the first gateway payment ID with the second and lose traceability.
The same financial representation must drive checkout, receipts, cancellation,
reports, invoice balance and customer self-service.

IMPLEMENT
- Per-tour opt-in percentage deposit and balance lead time. Full payment remains
  the legacy/default path. Validate percentages/dates and exact rounding.
  Fixtures use 30% deposit and balance seven days before departure. Bookings
  made at/after the balance due date require full payment initially.
- Snapshot payment terms and due amounts at booking. Derive them server-side
  from the accepted quote. Define voucher treatment explicitly; proposed v1:
  vouchers reduce the cash obligation first, then deposit percentage applies
  to the remaining cash. Customer wording must show that policy accurately.
- For a new deposit booking, successful deposit payment confirms its inventory
  and ends its initial checkout hold. Booking confirmation is independent of
  whether the balance is settled; do not falsely label a partial payment PAID.
- Introduce maintained deposit/balance checkout types with exact expected
  amounts, ownership checks, idempotency and durable checkout requests. A
  balance payment adds one verified capture and changes no seat counts.
- Serialize balance checkout, guest/reschedule amendments and refunds. One
  active obligation cannot be paid twice through two tabs. If an already-issued
  superseded checkout captures anyway, record the real capture and route excess
  to explicit reconciliation/refund; never discard money or mark it as new debt.
- Distinguish hold expiry from a balance deadline. Existing unpaid reminder and
  cancellation jobs must not classify deposit-confirmed bookings as unpaid.
  Overdue balances initially trigger reminders and operator review, not silent
  cancellation or deposit forfeiture. Reminders are idempotent per instalment.
- Amendments use remaining obligation and current funding, not presumed full
  payment. Preserve the original paid booking until any new required payment
  and destination reservation are committed. Reissue changed balance links
  safely, preserving capture history and detecting late old-link payments.
- A refund can reference multiple original captures, each within its remaining
  refundable cash. Reserve/finish each provider operation idempotently; an
  ambiguous timeout is retryable with the same provider idempotency key.
  Voucher credit is reissued separately, never refunded as card cash.
- Support cancellation before and after deposit/balance with an explicit
  applied policy and operator review where no policy is configured. Do not
  invent non-refundable deposit terms or assume all captured money is due back.
- All new booking statuses/payment states must be understood by manifests,
  completion/reminder jobs, customer access, reports and reports' legacy
  amountReceived fallback. A new enum/status alone is insufficient.
- Initially support the primary single-operator provider and full existing
  direct booking lifecycle. Block deposits for combo/agent-collected/unsupported
  providers explicitly; legacy full payments remain functional.

ACCEPTANCE
1. R10,000 booking, no vouchers: R3,000 deposit, then R7,000 balance. After deposit,
   the booking is confirmed, capture=R3,000, outstanding=R7,000 and seats remain
   reserved after hold expiry. Invoice and self-service show the same figures.
2. R10,000 booking with R1,000 voucher under the specified policy: R9,000 cash
   obligation, R2,700 deposit, R6,300 balance. Capture and voucher ledgers never
   count the voucher as gateway cash. A fully voucher-funded booking charges zero.
3. Exact-cent rounding, 100% deposit, invalid percentages, zero-value cash
   obligation and a booking inside the seven-day deadline are covered.
4. Replayed deposit/balance events add no duplicate money, capacity or messages.
   Balance-before-deposit, wrong amount/currency and invalid signatures fail
   or reconcile under an explicit tested policy, with no invented payment.
5. Concurrent balance requests issue one obligation. Late capture on a replaced
   link is recorded and surfaced without over-fulfilment or lost money.
6. Unpaid auto-cancel/expiry jobs leave deposit-confirmed bookings intact.
   A failed reminder can retry once without duplicating checkout or debt.
7. A fully refundable cancellation after R3,000 deposit refunds at most R3,000;
   after both payments it allocates at most R10,000 across their capture IDs.
   Partial refund, provider timeout and replay preserve all ceilings.
8. Increase, decrease and reschedule after deposit update the obligation and
   balance correctly; concurrent amendment/payment/refund does not lose funding.
9. Existing full-payment, manual, voucher and refund journeys remain valid, and
   foreign customers/operators cannot create a balance link or refund request.

This is a money-path change. Real database and mocked-provider failure/race tests
are mandatory. Keep enablement off until the complete selected lifecycle passes.
```

## 08 — Fixed multi-day itineraries and manual supplier tracking

Dependencies: 01–04; 05 for shared resources; 07 only if deposits are sold. Included in the requested multi-day scope.

```text
Support a fixed multi-day escorted tour without building a standalone hotel/PMS
system or a bespoke travel quotation engine.

Read app/lib/duration.ts and mirrored duration helpers, components/WeekView.tsx,
slot date-range queries, guide views, booking calendars, booking/app/api/ics,
cron-tasks completePastBookings, review/reminder jobs, reports and any resource
intervals implemented in 05. Read the prior accommodation prompt for context,
but do not treat nightly-stay decisions as this tour's booking model.

SCOPE
One fixed itinerary, one departure, one seat pool, one booking per party and
the existing selected payment model. A marketing duration of three days is not
necessarily 72 elapsed hours. Accommodation is manually arranged/tracked; no
claim of live hotel room stock. No room allocation, dynamic packages, flights,
supplier portal, automated purchasing or availability integrations.

IMPLEMENT
- Add an explicit actual end timestamp to departures and an itinerary with
  ordered days, stops/activities, included meals/accommodation descriptions and
  meeting/return instructions. Use the existing catalogue from 02 and simple
  validated content structures. Keep business/date timezone semantics explicit.
- For legacy departures, preserve existing behaviour until an operator supplies
  a return time; do not silently rewrite historical ends. New multi-day tours
  require an explicit end before publication. The accepted booking records the
  applicable itinerary/return details; later changes are explicit revisions.
- A three-day tour leaving Monday 09:00 and returning Wednesday 17:00 consumes
  its own departure seat pool once, spans Monday through Wednesday in calendars,
  and occupies assigned resources through Wednesday 17:00 plus buffers.
  Do not create three booking rows or one reservable slot per day.
- Calendars and operational lists must include trips overlapping the viewed
  date range, including those that started before it. Distinguish in-progress
  tours from new departures. Completion, review timing, return details and ICS
  must use actual end timestamps consistently.
- Add minimal tenant-private supplier commitments for a departure/itinerary
  item when needed: supplier name/reference, item/date, requested/confirmed/
  cancelled status and internal notes. Relationships stay within the tenant.
  Supplier commitments are manual records, not evidence of live availability.
- Unconfirmed required supplier items produce a clear readiness warning and
  cannot be represented to the customer as a guaranteed confirmed package.
  Default publication/confirmation to requiring essential commitments confirmed;
  if a request-to-book policy is needed, record it as a separate future scope,
  not an accidental use of PAID/PENDING statuses.
- Provide the customer itinerary and printable operator run sheet, reusing
  existing document/rendering tools. Internal supplier notes and commercial
  references must not leak into customer documents or bot context.
- Supplier cancellation or a return-time change prompts operator review and
  the existing booking-change/cancellation workflow. Do not automatically buy
  substitutes, charge extra, cancel paid guests or issue refunds.

ACCEPTANCE
1. Monday 09:00–Wednesday 17:00 displays exactly those days and return time in
   admin, customer summary, itinerary and ICS, without a Thursday completion.
2. A Wednesday-only/week-boundary query includes the trip that began Monday.
3. Review/completion jobs do not run before actual return and run once after
   the applicable existing grace period. An itinerary day does not issue a
   separate booking confirmation or duplicate financial revenue.
4. Passenger inventory is counted once. A shared vehicle/guide is unavailable
   throughout the actual interval and available after return plus buffers.
5. Month/year/DST boundaries and a trip already in progress are tested.
6. Missing required hotel confirmation prevents an instant confirmed package
   promise; entering a manual confirmation reference resolves the warning.
7. Customer output contains the itinerary but no supplier cost/private notes;
   tenant B cannot inspect or change tenant A's supplier records.
8. Editing a template does not rewrite a sold itinerary. An explicit revision
   records what changed and queues at most one notice per affected booking.
9. Existing short tours and all selected pricing/deposit/private-mode flows
   remain correct. Unsupported feature combinations are rejected server-side.

List rooming, supplier payments and bespoke quotation work as exclusions from
this phase; phases 09–10 cover the selected package extensions.
Do not claim full package-management support from this fixed-tour release.
```

## 09 — Package accommodation, rooming and supplier costs

Dependencies: 03–04 and 08; 05/07 when those capabilities are sold. Included in the multi-day package scope when accommodation is bundled.

```text
Extend fixed multi-day tours to sell an accommodation-inclusive package with
rooming choices, manual supplier allotments and supplier cost tracking. This is
operator-contracted package inventory, not a hotel booking engine.

Read the accepted quote/category/payment model from 03/07, passenger records
from 04, itinerary/supplier commitments from 08, and existing privacy, reporting,
amendment, cancellation and hold operations. Extend these models rather than
creating a disconnected package checkout or another customer booking per night.

IMPLEMENT
- Define package accommodation components with supplier, check-in/check-out
  dates, room types, occupancy limits, included meal description and manually
  confirmed allotment. A departure-specific allotment represents a distinct
  supplier commitment to that departure, not the supplier's total room stock.
  Do not duplicate one supplier allotment across departures as separate stock.
- Record each applicable night's contracted room availability. An arrival Monday
  and departure Wednesday uses Monday and Tuesday nights, not Wednesday night.
  A multi-hotel itinerary must validate availability for every required stay.
- Support a small fixed set of choices: single and twin/double room, explicit
  occupant count, and configured whole-stay or per-night single supplement.
  Name the supplement basis in configuration and the accepted quote. Default
  to whole-stay for the example; never multiply it by nights a second time.
- Let parties provide a rooming plan and, when names are known, assign their
  passengers. Do not silently pair strangers or infer sharing from gender/age.
  An unmatched single traveller selects a single option or requests operator
  assistance. Family-room/child-sharing exceptions require explicit occupancy
  rules; unsupported combinations must be unavailable, not improvised.
- Server-side package quote includes passenger base rate, selected supplements,
  extras, discounts and funding exactly once. Supplier net costs are separate
  internal values, not customer prices. Snapshot both agreed customer pricing
  and the supplier cost/confirmation revisions used by operations.
- A booking hold must reserve departure seats plus all required room-night
  allotments atomically. Lock in deterministic order, fail all if any component
  is unavailable, and use the existing hold/payment lifecycle. Deposit/full
  payment converts the same holds; it does not allocate rooms a second time.
- Guest, room-type, date and hotel amendments validate all new allocations and
  any uplift before releasing old confirmed allocations. Expiry/cancellation
  releases internal allocations once. Supplier contractual cancellation is a
  separate manual status: releasing internal rooms does not prove the hotel
  cancelled the reservation or returned money.
- Add supplier cost lines with exact basis (per room/night, person, group or
  fixed service), quantity, agreed amount, due date, confirmation reference,
  cancellation terms supplied by the operator and manual payment references.
  Use ZAR throughout this version; reject unsupported currencies explicitly.
  No bank transfer execution, foreign exchange service or supplier emailing.
- Show projected/confirmed package contribution: customer agreed value less
  committed supplier costs, clearly labelled before overhead/tax adjustments.
  Separately show cash collected, supplier payments recorded and supplier
  balance. Do not report all customer receipts as profit or supplier payments
  as customer refunds. Changing a supplier cost must not retroactively change
  a guest's accepted price. Preserve financial history with adjustments.
- Provide rooming list and supplier-service run sheet with appropriate staff
  access. Customer itinerary shows included accommodation and accepted room
  choice, without supplier net cost, margin, payment reference or other parties'
  passenger details. Add privacy export/deletion handling for new records.

ACCEPTANCE
1. Three passengers on a Monday–Wednesday package choose one twin room and one
   single. Exactly one twin and one single are held on Monday and Tuesday;
   Wednesday night remains available. Departure passenger inventory is three,
   not six passenger-nights and not two rooms.
2. Base R5,000 per person plus a R1,500 whole-stay single supplement totals
   R16,500 before other adjustments. Supplier twin R1,000/night plus single
   R700/night for two nights costs R3,400; these internal costs never replace
   the customer selling price or leak through public responses/documents.
3. Competing parties racing for the last single room yield one winner even
   when departure seats remain. A missing second-night or second-hotel room
   rolls back every newly attempted room and seat hold.
4. Deposit capture, full payment, replay, expiry and cancellation reconcile
   all room-night and seat counters exactly once. Late capture cannot resurrect
   a room allocation already sold to another party.
5. Changing a twin to two singles fails without sufficient single allotment and
   leaves the original twin intact. Successful changes use an accepted uplift
   or approved refund and update rooming/manifest records consistently.
6. Supplier cancellation charges remain a recorded commitment until explicitly
   resolved; cancelling the guest does not invent a supplier refund. Payment
   reference retries do not duplicate an internally recorded supplier payment.
7. Hotel/room references from tenant B fail for tenant A. Two customers on the
   same departure cannot see each other's rooming/person records. Sensitive
   supplier costs are restricted by role on APIs and the database.
8. Multi-day packages without accommodation and existing day tours still use
   their existing inventory paths. Unsupported room-sharing or currency choices
   cannot reach a misleading instant confirmation or incorrect charge.

Do not use the nightly accommodation prompt's one-property booking model for
the package: this remains one tour booking with multiple component allocations.
No claim of live supplier room availability or full hotel management is allowed.
```

## 10 — Tailor-made quotations and request-to-book conversion

Dependencies: 02–04, 06, 08–09; 05/07 when used. Optional: only for operators who customise itineraries per party.

```text
Implement a small versioned quotation workflow for tailor-made tour packages.
Keep an enquiry/quotation separate from a booked and financially confirmed trip.
Fixed-departure instant sales must keep their existing simple workflow.

Read the quote/payment snapshots, private-departure inventory, package component
allocations and supplier commitment models from prior selected phases. Reuse
the existing customer identity, inbox, controlled content and PDF/print tools.

IMPLEMENT
- Add a tenant-owned enquiry with requested dates, party size, preferences and
  contact details. Create an operator-edited draft itinerary and quoted price
  from existing components, including internal supplier cost estimates.
- Quote states: draft, issued, accepted, declined, expired, superseded and
  converted, or the smallest equivalent state model with those distinctions.
  An issued version snapshots itinerary, party/room choices, inclusions,
  selling price, currency, commercial terms and expiry. Edits create a new
  version; customers never accidentally accept a different revision.
- Provide customer preview/acceptance with scoped, expiring, unguessable access
  using existing access patterns. Protect contact/itinerary data from public
  listing and enumeration. Supplier net costs/margins remain private.
- No stock is reserved by a draft or merely issued quotation. State this in
  the customer view. Customer acceptance records their intent; it is not
  proof that a hotel or vehicle has been secured or payment captured.
- Operator approval checks supplier confirmation and live seat/resource/room
  availability, then converts the accepted quote exactly once into the existing
  private tour booking and component allocation flow. Create only the minimal
  unpublished departure/catalogue reference needed by current bookings.
  Customer-specific quotes must not appear as public catalogue products.
- Validate the accepted quote version and expiry inside the conversion
  transaction. Tie the authoritative checkout to the stored approved quote.
  Never pass a client-supplied manual price into ordinary checkout and bypass
  its price checks. No cash is taken until the supported reservation/confirmation
  prerequisites are satisfied.
- If the itinerary is unavailable, retain the enquiry/acceptance and explain
  the pending operator decision. Do not fabricate a confirmed booking, silently
  substitute a hotel, raise the price or charge against unavailable components.
- Use the selected deposit/full-payment lifecycle after conversion. An expired
  payment hold requires availability revalidation before issuing a new checkout.
  Paid itinerary changes follow amendment/version rules, not edits to the
  original quote total. Financial/supplier history must remain auditable.
- Provide printable customer proposal and confirmed itinerary. Record manual
  sharing/supplier confirmation actions; no automatic outreach or purchasing
  in this implementation. No CRM sales automation, flights or dynamic FX.

ACCEPTANCE
1. Issued quote v1 expires; accepting it fails even if the customer kept its URL.
   Superseding v1 with v2 also prevents acceptance/conversion of v1.
2. Issued quotes create no seat/room holds. Accepting a quote with unconfirmed
   supplier items shows pending review and takes no payment.
3. Two clicks/tabs/webhook retries converting one accepted quote produce one
   booking, one reservation set and one initial payment obligation.
4. Availability lost after issue is detected at conversion, leaving no partial
   seat/room reservations or charge. The proposed trip remains recoverable.
5. A tampered quoted total, room mix, foreign quote ID or acceptance token cannot
   alter the server price or disclose a different party's proposal.
6. R16,500 accepted quote with 30% deposit charges R4,950 and retains R11,550
   outstanding with the same accepted itinerary revision. Client edits cannot
   change the charge; expiry and late payments follow the existing recovery path.
7. Supplier cost edits affect internal contribution estimates, not accepted
   customer price. A customer-facing change requires an explicit new agreement.
8. Fixed departure/day-tour checkout, public catalogues and privacy exports
   continue working; no private proposal or supplier margin is publicly exposed.

Deliver only this enquiry-to-booking workflow. Record any requested agent credit,
automated supplier purchase or full CRM feature as separate scope.
```

## 11 — Referring agents and commission reporting

Dependencies: 03 and existing reporting/payment lifecycle; optional.

```text
Add minimal referring-agent attribution and commission reporting for bookings
where the operator collects the customer's money directly.

Read bookings source/external/supplier financial fields, external-booking API,
app/reports/page.tsx, report-accounting, combo settlements and existing invoices.
Do not treat supplier_commission_amount or cross-tenant combo settlements as an
unexamined general travel-agent ledger.

IMPLEMENT
- Add tenant-owned referring-agent records: display name, active state and a
  configured commission basis/rate. Start with percentage of eligible tour
  subtotal after discount, excluding extras and refunded eligible value.
  The basis must be explicit, snapshotted and shown to the operator. Do not
  decide actual tax treatment or contract terms for a live agent.
- Associate a referral with a booking using an operator-controlled flow or
  validated referral code. A public code is attribution, not permission to see
  the booking or choose a commission rate. Customers cannot submit arbitrary
  agent IDs/rates or claim another tenant's agent.
- Preserve the existing booking source/channel fields. An agent-referral
  dimension is distinct from WEB, ADMIN, generic external API and OTA source.
- Keep customer gross price, actual customer receipts, refund value, commission
  accrued, commission settled and outstanding commission distinct. Customer
  receipts remain gross operator receipts; commission is a separate payable.
  Do not reduce total_captured to represent commission expense.
- Accrue the commission under a clear status policy; proposed v1 is after trip
  completion with required customer funding settled. Cancelled/expired bookings
  accrue none. Refunds reduce the eligible base; refunds after settlement create
  a visible adjustment/credit rather than silently rewriting settled history.
- Provide filterable booking-source and agent-commission reports and CSV export.
  Allow MAIN_ADMIN to record an externally completed commission settlement with
  amount/date/reference. No automatic payout or message to an agent is included.
  Make retries idempotent and audit changes to referrals and settlements.
- No agent login portal, credit limits, net-rate contracts, agent-collected
  money, automatic settlement integrations or new cross-tenant data sharing.
  Clearly reject those unsupported accounting modes if exposed in input.

ACCEPTANCE
1. R2,000 eligible tour subtotal plus R200 extras and a 10% commission produces
   R200 commission, not R220. An eligible R500 tour refund reduces it to R150.
2. Gross customer receipts remain unchanged by commission accrual/settlement;
   card captures, vouchers and operator net-after-commission are not conflated.
3. A deposit-only incomplete booking does not accrue commission prematurely.
4. Duplicate settlement submission records one settlement. A post-settlement
   refund creates an adjustment and preserves the original settlement history.
5. Changing an agent's rate affects future bookings only; historical agreed
   commission and completed settlements remain auditable.
6. A tenant-B agent/code cannot be attached to tenant A. Public referral users
   cannot read bookings or control rates. OPERATOR cannot record a financial
   settlement unless an existing explicit permission allows it.
7. Reports/CSV reconcile to the underlying booking and commission entries,
   including cancellations, vouchers, partial refunds and legacy bookings.

Deliver this as attribution and payable reporting, not a claim of full agency
or supplier accounting. Leave native OTA readiness safeguards intact.
```

## 12 — Independent implementation checks and release evidence

Dependencies: common prompt plus the selected completed phases. Use in a fresh review session. No delegation is required.

```text
Act as the acceptance reviewer for the selected BookingTours tour-operator
changes. Review and run checks; do not deploy or alter production. Do not assume
the implementation model's completion summary is proof. This is a review task:
report defects and precise repair instructions; do not implement repairs unless
separately asked.

INPUTS
Read the readiness review, selected phase prompts, both repositories' current
status/diffs, implementation reports, new migrations and actual source. Verify
the reviewed revision includes all related nested booking-repository changes.
Use the common prompt's testing and isolation constraints.

TRACE BEFORE TESTING
1. Build a requirement-to-evidence matrix for each selected phase: UI entry,
   server validation, persisted representation, transaction, customer output,
   operational output, cancellation/amendment/expiry and executable test.
2. Map every active booking/capacity/payment writer. Identify bypasses through
   direct API/SQL grants, legacy bots, manual entry, external booking, combos,
   cron jobs, vouchers, late webhooks and already-issued payment links.
3. Verify new tables/relations are tenant-owned with RLS and least grants, new
   financial/operational states are understood by all readers/jobs, and snapshots
   cannot be edited by unauthorised clients.
4. Check that advertised support matches tested capability. An explicitly
   unavailable optional combination is acceptable only if the selected phase
   permits it and the customer is handed off before payment/reservation.

TEST MATRIX
Use tenant A, tenant B, MAIN_ADMIN, OPERATOR, an unauthorised/suspended identity
where relevant, two customers, and a dedicated synthetic notification sink.

- Legacy regression: a one-price scheduled tour with full payment, extras,
  promotion, partial voucher, self-service access, amendment, cancellation and
  a refund bounded by actual funding.
- Day tour: two adults plus child, required question, valid included pickup,
  authoritative charge, confirmation, mobile manifest and individual attendance.
- Booking rules: distant departure, exact cutoff, failed direct bypass, timezone
  independent generation and tenant-specific settings.
- Private tour if enabled: two racing parties, one exclusive reservation,
  passenger change, expiry and late capture after replacement reservation.
- Shared resources if enabled: overlapping tours, simultaneous assignment,
  edit/reassignment conflicts, vehicle capacity reduction and buffers.
- Deposits if enabled: initial deposit, confirmed inventory through expiry,
  outstanding balance, reminders, concurrent balance attempts, replay/out-of-order
  events, amendment after deposit, refund across capture IDs, provider timeout.
- Multi-day if enabled: Monday–Wednesday trip, actual return, overlapping
  calendar queries, supplier readiness, resource occupancy and review timing.
- Accommodation packages if enabled: rooming/occupancy rules, room-night
  allotments, multi-component hold races, supplements, supplier costs/payments,
  late capture after inventory release and internal-versus-supplier cancellation.
- Tailor-made quotes if enabled: version expiry/supersession, private preview,
  pending supplier confirmation, price tampering, availability revalidation
  and idempotent accepted-quote conversion to one booking.
- Agents if enabled: commission basis, refunds, settlement replay and history.
- All selected features: tenant/caller tampering, unauthorised direct URLs/RPCs,
  stale customer proofs, safe exports, privacy deletion, empty/error/loading
  states, phone layout and keyboard use.

EXECUTION STANDARD
Run relevant unit/runtime tests, both affected app typechecks/lints/builds,
edge checks, database migration/upgrade/isolation tests and isolated Playwright
journeys. Use two independent DB connections and a controlled start barrier for
race tests; repeat races enough to detect lost updates. Assert final bookings,
holds, resource allocations, captures, refund reservations and notifications,
not just HTTP status. Assert SQL invariant rows, not only process exit code.

Test injected failures before and after the external provider call, database
commit and notification enqueue. Demonstrate recoverability after a provider
accepted payment but the application lost its response. Check cleanup only
touches test-run-owned data. A passing mocked test alone does not prove a real
database constraint, and a skipped browser test is not a pass.

Confirm migration ordering and representative existing-row upgrades. Review
how enablement/disablement and rollback keep new bookings serviceable: reverting
to old code that assumes qty equals reserved inventory or one payment per booking
may be unsafe. Record an application-compatible rollback or forward-fix plan.

OUTPUT
Write a release acceptance report with:
- Exact reviewed revisions/diff scope and selected capability set.
- PASS / FAIL / NOT RUN for each requirement, linked to runnable evidence.
- Defects ranked by customer impact, with reproduction, file/function, expected
  versus actual state and a concrete repair check. Include missing channel
  support and missing tests as such; do not invent observed runtime failures.
- Separate pre-existing failures from regressions. Do not waive a security or
  money defect because it was pre-existing if the release depends on that path.
- Go/no-go for an isolated pilot and separately for live release. Missing
  database/concurrency/payment evidence means not verified, not release-ready.
- Exact remaining commercial/provider prerequisites, rollout order, component
  list and rollback/disable notes. Native OTA certification remains external.

Do not mark any capability complete until its selected phase's acceptance cases
are satisfied. Do not make unsolicited production writes while verifying.
```

## How to select the work

For a day-tour operator with family prices and hotel pickup, use the common prompt with 01, then 02, 03 and 04. If their wine tour and peninsula tour share one minibus, add 05 before enabling both for sale. If they sell an exclusive group trip, add 06. If they take a deposit, add 07. For fixed multi-day tours use 08; for accommodation-inclusive packages add 09. Customised quotations are 10, referring-agent reporting is 11, and independent acceptance review is 12. Both requested business models can be delivered in stages; completion of the day-tour stage alone does not mean the package stage is complete.

The real operator's rates, pickup commitments, minimum numbers, commercial payment/refund terms and supplier agreements still need to be entered deliberately. The numerical examples above are acceptance-test fixtures only.
