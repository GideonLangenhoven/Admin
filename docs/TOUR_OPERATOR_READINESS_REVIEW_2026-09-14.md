# Tour operator readiness review

Reviewed 14 September 2026. Companion: [implementation prompt pack](prompts/TOUR_OPERATOR_IMPLEMENTATION_PROMPTS.md).

## Recommendation

BookingTours can already support a straightforward tour operator who sells seats on scheduled departures, charges everyone the same rate, takes payment in full, and meets guests at a fixed location. A walking tour or sightseeing departure can use the same booking mechanics as a kayak trip. A separate application or a new “tour operator mode” is unnecessary for that business model.

You confirmed that the scope is **both day tours and multi-day packages**. I recommend two staged releases: day tours with passenger categories, pickup information, richer tour details and configurable departure rules; then multi-day packages with actual return times, day-by-day itineraries, rooming/allotments and supplier commitments/costs. Add shared vehicle/guide scheduling wherever the same people or vehicles serve multiple products. Private tours, deposits, tailor-made quotations and agency accounting depend on the operator's sales model. Completing the day-tour stage alone does not satisfy the full requested scope.

This is a capability review and implementation brief, not a production certification. No application code, database, deployment, or customer communications were changed for this review.

## Scope and evidence

I reviewed the current admin application, customer booking application, relevant edge functions, migrations, schema fixtures, existing tests, and product/release documentation. Admin HEAD was `6a630c0`; the nested `booking/` repository HEAD was `99b71f0`. Both contain substantial existing uncommitted work, which is included in these findings. A model implementing this brief must preserve it and inspect both repositories.

The installed database was not queried. Schema fixtures and migrations are repository evidence, not proof of live schema. This distinction matters here: the initial remote migration is effectively empty, and later migrations document schema that was applied outside the recorded migration chain. Do not assume a fresh migration reset reproduces production.

I ran nine relevant existing unit-test files: **97 tests passed**. These cover duration, admin timezone helpers, report accounting, chat pricing, storefront checkout, external integration safeguards, hold expiry, payment accounting, and partial vouchers. Some are source assertions or mocked handler tests. They do not establish real database concurrency, browser usability, or production payment success.

The recommendations below are product judgments based on the code. As a limited industry cross-check, established tour booking products describe structured pickup locations/times and passenger questions, rather than treating these as an undifferentiated note. See [Rezdy's pickup documentation](https://support.rezdy.com/hc/en-us/articles/19867826805788-How-To-Create-Pickups) and [Rezdy's booking API specification](https://developers.rezdy.com/rezdyapi/index-reseller.html). Those examples support the workflow categories; they are not a recommendation to reproduce an entire competing product.

## What is already useful

| Capability | Repository evidence | Implication |
|---|---|---|
| Separate branded operators and role checks | `components/BusinessContext.tsx`, `app/lib/api-auth.ts`, `_shared/tenant.ts`, operator-access migrations | Reuse the existing tenant model. An operator is already a business, not a new entity type. |
| Tour catalogue, scheduled departures and seat limits | `app/settings/page.tsx`, `app/slots/page.tsx`, `booking/app/lib/types.ts` | Standard scheduled tours fit the current core. |
| Seasonal/slot prices, extras, promotions and vouchers | `app/pricing/page.tsx`, `20260911130000_checkout_pricing.sql` | Extend the existing authoritative quote rather than introducing a separate pricing service. |
| Direct website/widget, manual and conversational bookings | `booking/app/book/page.tsx`, `app/new-booking/page.tsx`, `web-chat`, `wa-webhook` | New fields must be supported or explicitly handed off across these entry points. |
| Payment confirmation, amendments, refunds and cancellation | September checkout/amendment/cancellation/refund migrations and corresponding functions | Considerable reusable machinery exists, but its assumptions must be checked for each new booking type. |
| Customer communications, self-service, invoices and reporting | `auto-messages`, `send-email`, `booking/app/my-bookings/`, `app/invoices/`, `app/reports/` | Extend the existing booking lifecycle; do not build duplicate customer management. |
| Guide check-in and photos | `app/guide/`, `app/api/guide/check-in/route.ts` | Useful foundation for a passenger/pickup manifest. Current check-in is for a whole booking. |
| Custom questions and waiver participant details | Admin manual booking, both bots, `booking/app/waiver/page.tsx` | Part of the data collection exists. It is not yet a consistent passenger record across all channels. |
| Multi-day duration and calendar display | `app/lib/duration.ts`, `components/WeekView.tsx` | A fixed multi-day departure is partially represented already. This is not accommodation or supplier inventory management. |
| Combo offers and partner settlements | `app/partnerships/`, combo functions and migrations | Reuse for their supported linked-activity workflow. Do not assume they form a complete travel-package or agency accounting system. |

## Gaps and recommended changes

### 1. Departure rules and advance booking: first priority

The storefront searches only the next 60 days in `booking/app/book/page.tsx` around lines 190–195. Booking cutoffs are fixed at 60 minutes in `booking/app/lib/pricing.ts`, both bots, and database booking/amendment functions. Several reservation paths also cap a booking at 50 passengers. These are implementation limits, not operator-configured tour rules.

A tour operator may need next-season bookings, sales closing the previous day, a minimum viable departure size, and a different maximum party size. Add per-tour settings with existing-compatible defaults, a consistent booking horizon across channels, and database enforcement. Treat the minimum departure size separately from the minimum size of one customer's booking. Initially, flag underfilled departures for an operator decision; do not introduce automatic cancellation.

There is also a concrete existing timezone defect in `app/lib/slot-generation.ts`: it derives dates through UTC and subtracts two hours in the browser. `components/BulkSlotWizard.tsx` uses it. I executed that function with a mocked database under three host timezones: a Johannesburg departure requested for 5 October 2026 at 09:00 should store `2026-10-05T07:00:00Z`, but a Johannesburg browser stores `2026-10-04T05:00:00Z` and a New York browser stores `2026-10-05T11:00:00Z`. Only the UTC-host case matched. Other generators already use tenant timezone conversion. Fix and align these paths before relying on bulk-generated tour schedules. The passing existing helper tests do not cover this defective bulk-generator path.

### 2. Passenger categories and pricing: first priority for family tours

The manual booking form has adult and child inputs, but `app/new-booking/page.tsx` around lines 410–416 adds them into a single `qty` and charges one `unitPrice`. The booking payload saves that combined count. The storefront also uses one guest count and one price. The server quote calculates `unit * qty`.

Add configurable passenger categories with explicit rates and age descriptions, save the booked category counts, and produce an immutable server-calculated price breakdown. Example: two adults at R1,000 plus one child at R600 should cost R2,600 and consume three seats. A zero-priced category must still consume a seat in the first version. Do not infer transport safety rules from price or age.

Seasonal rates, amendments, promotions, vouchers, invoices and reports must agree with this breakdown. A new child selector alone would leave the server charging the old price.

### 3. Tour information and booking questions: first priority

There is already a tour description, image, duration and meeting point. Add structured itinerary stops, inclusions/exclusions, languages offered, and relevant preparation/access information. A basic ordered itinerary is enough for a day tour; a route optimisation or content-management platform is unnecessary.

Custom questions already work in manual entry and conversational flows, but the inspected main storefront form does not render or submit `booking_custom_fields`. Required information can therefore depend on the channel used. Close that gap, validate on the server, and distinguish party-level questions from information needed for each passenger.

Keep waivers only where the operator requires them, but do not remove booking proof tokens: `waiver_token` also participates in booking access and checkout verification. Making a waiver optional must not make booking access public. Do not invent legal policies; use the operator's supplied content.

### 4. Pickups and passenger manifests: first priority for transported tours

The present meeting point and free-text questions cannot reliably answer “which guests are at which hotels, at what time, and have they boarded?”

Add a small operator-owned list of pickup points, select which tours offer them, and save a booking's selected location and pickup time. Start with included pickups and one pickup per party. Customers may meet at the departure point. Free-text hotel requests should remain explicitly unconfirmed until accepted. Paid transfers or separate transfer-seat pools can follow when a real operator needs them.

Extend the existing guide app with pickup ordering, passenger counts/categories, necessary operational notes, and a print/export manifest. Add passenger-level attendance when individual names are collected. Participant names and dates of birth currently captured inside a waiver are not a general passenger list; do not invent missing identities or make sensitive waiver contents broadly visible.

Rescheduling must recalculate the pickup time and check that the new tour still supports the point. Changes to an operator's pickup catalogue should not silently rewrite instructions already sent to guests.

### 5. Vehicle and guide availability: required when departures share resources

Availability is currently calculated per slot. The same minibus could be sold through two overlapping tours without the system understanding the conflict. A previous shared-resource feature was deliberately removed in `20260706130000_remove_shared_resources.sql`; its availability check was read-only and never enforced booking writes.

The smallest dependable replacement is manual assignment of named vehicles/guides to departures, with overlap checks enforced in the database, including setup/travel buffers. Reserve an assigned resource for the departure interval, not once per passenger booking. Vehicle capacity must constrain sellable seats, and reducing vehicle capacity must not invalidate existing reservations.

Keep the current role model initially. A named guide assignment does not automatically provide restricted guide-only login access. Add a restricted staff capability only if a pilot actually needs it, with server-side and database enforcement.

### 6. Private tours and charters: optional, substantial

A R5,000 private tour for a party of four must block the whole departure, even if the vehicle has eight seats. The current model sells passenger seats. Creating a generic R5,000 extra or changing `qty` to one would respectively permit a second party or misreport passenger totals.

Add an explicit exclusive departure mode and separate passenger count from inventory consumption. Start with one group rate per departure and a maximum party size. Every hold, payment, guest edit, reschedule, cancellation and expiry must preserve exclusivity. Bespoke quotations and multi-vehicle private bookings can be later work.

### 7. Deposits and balance collection: optional, substantial

The system has payment links, captured/refunded amounts and additional-payment machinery. It does **not** currently expose a complete deposit schedule. `create-checkout` does not include `DEPOSIT_50` in its actual allowed checkout types, despite comments referring to deposits. `confirm_booking_payment` validates the full expected amount and then marks the booking paid. Existing reminders are designed around unpaid upcoming bookings, not future balance instalments.

Add an explicit two-payment schedule: deposit now, balance due on a configured date. Preserve the difference between booking confirmation, cash received, voucher funding and remaining debt. A confirmed deposit booking must retain capacity after the original checkout hold expires and must not be auto-cancelled as though nothing had been paid.

This must include receipts, reports, overdue balances, multiple payment references, refund allocation across captures, and amendments after the deposit. It is not safe to implement by dividing the checkout amount by two.

### 8. Multi-day tours and packages: required second release

A fixed three-day escorted tour can remain one departure with one passenger inventory pool and one booking per party. Add day-by-day itinerary, actual return time, operational notes, and manually maintained supplier confirmations where needed. Do not create one customer booking per itinerary day.

There is an existing semantic mismatch to resolve: `tourEndDate` treats a three-day tour departing Monday as ending Wednesday, while `cron-tasks` computes completion as start plus 4,320 minutes, which reaches Thursday. That affects return displays, reminders, reviews and resource occupancy. An explicit departure end timestamp is more reliable than interpreting a “3 days” marketing label as exactly 72 elapsed hours.

Room allocation, single supplements, hotel/room inventory, supplier purchase orders, live hotel availability and custom quotation versions are additional features, not already supplied by duration or combos. The first itinerary phase can record a supplier confirmation manually and make “awaiting confirmation” visible. It must not promise unconfirmed accommodation. [Bókun's tour-package guidance](https://www.bokun.io/how-to-create-tour-packages) likewise describes itinerary, accommodation and transport details as distinct package information.

For packages including accommodation, add room choices, occupancy limits and a rooming list; confirmed supplier room allotments for each required night; and an explicit single-supplement price. A three-day/two-night tour needs two nights of rooms while consuming tour passenger seats once. Seats and every required room-night must be reserved together, otherwise the system can take payment for a package whose hotel is full. This is a separate package-allocation phase, not a claim that BookingTours now controls a hotel's entire inventory.

Track supplier net costs, due dates, confirmation references and manually recorded payments separately from customer prices and receipts. A customer cancellation does not establish that the hotel cancelled its reservation or refunded the operator. Show the outstanding supplier commitment and a package contribution view, with explicit limits around overhead/tax treatment. [Tourwriter's itinerary-pricing documentation](https://learn.tourwriter.com/portal/en/kb/articles/itinerary-pricing-in-tourwriter) distinguishes supplier net cost from the traveller's selling price, which is the same important distinction here.

If the operator creates a different itinerary for each enquiry, add versioned quotations with expiry, acceptance and availability revalidation before booking/payment. Issuing a proposal should not secretly reserve inventory, and accepting it must not claim that unconfirmed suppliers are secured. This is conditional on selling tailor-made trips; fixed-departure packages can skip it. The prompt pack covers both paths.

### 9. Agent/referral accounting: optional

External bookings already have source, supplier payment/settlement, payout and commission fields. Combo settlements solve a different, explicitly cross-operator transaction. There is no evidence of a complete travel-agent workflow for contracted commission, agent receivables, statements, credit limits or customer ownership.

Start with source attribution, an optional referring-agent record, a snapshotted commission agreement, and an exportable commission report for direct-collected bookings. Do not repurpose supplier commission fields or combo payment splitting without defining whose money is being recorded. Agent-collected money, credit accounts, portals and automatic payouts require a further brief.

### 10. OTA distribution is a separate launch dependency

Native Viator and GetYourGuide adapters are explicitly blocked by `supabase/functions/_shared/ota-readiness.ts`. [The current integration note](OTA_DIRECT_CONNECTIVITY.md) describes prototype code, missing provider approval/certification, and the separate generic signed external-booking API. Saved mappings are not proof of working native connectivity.

If a prospective tour operator depends on automatic OTA sales, that is a material fit gap. The implementation prompts must keep the guard in place; provider-specific work needs the actual supplier contract, test access and certification. No prompt can substitute for those prerequisites.

## Suggested release sequence

| Release | Include | What it supports |
|---|---|---|
| Day tours | Prompts 01–04: dates/rules, catalogue/questions, passenger prices, pickups/manifests | Direct bookings for ordinary day tours; full payment; included pickup or meeting point. |
| Shared transport/staff | Prompt 05 | Add before selling overlapping products that share a vehicle or guide. |
| Private departures | Prompt 06 | Fixed-price exclusive groups, when sold by the pilot operator. |
| Deposit payments | Prompt 07 | Longer lead-time or higher-value bookings needing deposit and balance. |
| Fixed multi-day tours | Prompt 08, plus 05/07 if needed | Escorted itineraries with explicit return times and manual supplier tracking. |
| Accommodation-inclusive packages | Prompt 09 after 08 | Rooming, per-night contracted room allotments, supplements, supplier costs and payment records. |
| Tailor-made packages | Prompt 10 if sold; includes prerequisite private/package phases | Versioned proposals, acceptance and safe conversion to a confirmed booking. |
| Referral accounting | Prompt 11 | Direct-collected agent referrals with commission reporting. |
| Release acceptance | Prompt 12 after every selected release | Evidence for actual supported journeys and regression safety. |

Do not give an implementation model all optional phases as one undifferentiated task. The common prompt and each selected phase define a bounded result and acceptance tests. Source/rate/resource changes must be checked against every active booking channel, not just the visible form.

The simplicity skill used for this review influenced this sequence: reuse tours, slots, booking records, payment operations and the guide app; add new models only where exclusivity, resource overlap or instalment accounting requires them. Do not revive the deleted general-purpose resource pool or implement a hotel system merely to sell a three-day tour.

## Decisions to validate with a pilot operator

The overall day-tour and multi-day scope is confirmed. The following operating details remain unanswered. Defaults in the prompt pack are proposed implementation defaults, not agreed commercial terms.

- Scheduled public departures, private groups, or both? Fixed itineraries or bespoke quotations?
- Which passenger categories/rates, maximum party size, and minimum departure size?
- How far ahead should bookings open, and when should sales close?
- Fixed meeting points, included hotel pickups, or separately sold transfers?
- Shared vehicles/guides, and how long are setup/travel buffers?
- Full payment or deposit; if deposit, what amount and balance deadline?
- Multi-day accommodation already contracted, manually confirmed, or requiring live inventory?
- Direct sales only, referring agents, agent-collected sales, or essential OTA automation?

The prompt pack supplies working defaults for an isolated test operator so engineering can progress without inventing the real operator's prices, refund policy or supplier commitments.
