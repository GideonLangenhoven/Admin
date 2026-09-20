# BookingTours: the cheapest credible route to 1,000 users

Prepared 17 September 2026. Owner: Gideon. This is an execution plan, not a guarantee or a record of acquired customers.

**Updated execution model:** You subsequently chose minimal founder work, twenty minutes of weekly video and qualified sales calls, with new social accounts/calendar still to create. Use [AI-led acquisition](ai-acquisition-system.md) for the current workload, social strategy, R3,000 allocation and initial experiment target: 8–12 activated businesses, of which 6–10 have paid by day 90. The thirty-hour founder schedule and 20–25 target below are retained as the higher-effort scenario, not the current default. [Social copy](social-launch-pack.md) and [the ledger](acquisition-ledger.json) are prepared; publishing is not active.

**Recommendation:** sell one useful workflow to a narrow group of South African activity operators, personally activate the first five, target twenty to twenty-five paying and using it within 90 days, then grow through operator introductions and agencies. Keep acquisition cash spending at or below your **R3,000/month** budget. Consider funding later growth from collected subscription revenue when the channel and retention work.

Ponytail applied: use the existing demo, discovery call, onboarding checklist and referral offer. One prospect ledger, manual follow-up and one weekly review are enough. Build acquisition automation only after a repeated manual task is demonstrably limiting sales.

## 1. Define the target before spending

You confirmed **1,000 distinct paying operator businesses**, **R3,000/month** available and as much founder time as needed. Start with **30 scheduled hours/week** on acquisition, onboarding and early customer care, then adjust to actual demand. Engineering, incidents and running your existing business need additional time. The growth calculation starts from zero independently verified customers; replace that baseline once current receipts and usage are checked. This document allocates a budget; no money has been spent.

Count an acquired business only when it has paid a software invoice, completed a genuine customer booking, and its owner or staff have used an operational workflow. Exclude internal/demo tenants, free trials, duplicate locations under the same commercial account, overdue unpaid accounts and staff invited only to inflate the count. At scale report current full-price trading accounts separately from seasonal paused subscribers, trials and churned accounts.

At R2,000 each, 1,000 full-price businesses represent R2m nominal monthly base subscription billings before tax treatment, discounts, pauses, costs and collection failures. Do not count staff accounts or traveller bookings toward the business target.

## 2. What the evidence says today

The public site and repository were inspected. Production customer counts, current invoice receipts and live provider configurations were **not** queried in this session. Historical records below are context, not today's verified baseline.

| Finding | Consequence before selling |
| --- | --- |
| The approved Standard plan is R2,000/month including one admin seat, plus R500/month per additional seat, with no setup fee. Card-processing and other provider charges are separate. The separately hosted public pricing page still showed R750 per additional admin when checked on 20 September 2026. | Deploy the current pricing migration and website copy together, then compare a real invoice preview with the published terms before accepting a customer. |
| The [current pricing migration](../../supabase/migrations/20260920090000_enforce_standard_plan_pricing.sql) enforces the approved base and seat price without rewriting paid history. | Verify it in the target environment; a committed migration is not proof of a production deployment. |
| The [August finance report](../finance/PLAN_2026-2031.md) recorded one real anchor operator, twelve test tenants and no collected platform revenue at that time. | First establish current paid, active and paused counts from receipts and usage. An ACTIVE database row does not prove revenue. |
| The [14 September payment note](../qa/YOCO_PAYMENT_CLOSEOUT_2026-09-14.md) leaves a fresh hosted payment/notification/refund journey outstanding and records Kayak in test mode then. | Complete the payment journey for each pilot before accepting public customer money. This is a dated unresolved check, not a claim that today's production is broken. |
| The [OTA release note](../qa/ALL_FIXES_RELEASE_2026-09-14.md) says uncertified native Viator/GetYourGuide adapters are blocked. | Exclude prospects who require those connections immediately. Do not promise automatic OTA inventory synchronisation. |
| The [tour capability review](../TOUR_OPERATOR_READINESS_REVIEW_2026-09-14.md) supports simple scheduled activities and identifies gaps for more complex tours. | Start with fixed meeting points, full payment and straightforward per-person pricing. Qualify deposits, pickups, age rates and multi-day requirements before offering a pilot. |
| The [mobile acceptance record](../qa/MOBILE_FIRST_IMPLEMENTATION_ACCEPTANCE.md) marks device verification pending for local changes. | Have the first owners complete the real booking and daily admin flow on their phones. Do not call an untested release mobile-verified. |
| A [public demo](https://claires-hiking.admin.bookingtours.co.za), [discovery page](https://bookingtours.co.za/demo) and [referral offer](https://bookingtours.co.za/refer) already exist. | Reuse them. Verify the demo and discovery calendar work before sharing. A page existing is not evidence of a tested conversion funnel. |

Keep the entry requirements short: one consistent quote, one successful payment/refund journey, usable phone workflow, a working demo/call link, and clear limitations. Prospect research and interviews can proceed while these are resolved.

## 3. Sell this first

**First segment:** owner-led Cape Town and nearby activity businesses selling scheduled kayak trips, standard surf lessons or guided day hikes. Start locally because introductions, visits and support cost less. Move along the Garden Route once the first segment is working.

Qualify for all five:

1. An owner can make the purchase decision and will attend setup.
2. Their chosen activity fits the current booking workflow without bespoke development.
3. They already receive meaningful direct enquiries and will put a booking link where customers can find it.
4. They describe a recurring problem with enquiry handling, payments, daily bookings or cancellations.
5. The value justifies the actual monthly quote, including seats and usage charges.

Start conversations with businesses already processing enough bookings to feel the pain. Do not assume that a micro-operator can afford R2,000 because it has a website. A useful discovery question is: “In the last week, what happened from an enquiry arriving to the money being received?”

**Offer:** a 20-minute demonstration followed, if suitable, by assisted setup of one activity. Agree the full price and billing start date in writing. Publish that activity only after its booking/payment checks pass. Expand the customer's usage after its first successful bookings.

**Message:** “BookingTours helps activity operators turn their existing enquiries into paid bookings and manage the day's guests in one place. We'll show you the workflow using one of your activities.”

Lead with the one problem the owner names. If WhatsApp is the reason they buy, explicitly include the provider setup dependency: the [public onboarding description](https://bookingtours.co.za/demo) estimates roughly five business days subject to Meta approval; it is not a guaranteed deadline.

**Price/value example, not a results claim:** saving 12 admin hours at the owner's own R200/hour valuation is R2,400/month. Alternatively, eight additional bookings at R250 contribution after variable delivery costs cover a R2,000 base fee. Verify those inputs with the owner; never compare subscription cost with gross ticket revenue as though it were profit. Separately assess displaced software fees and lost distribution benefits when switching providers.

Avoid unconditional revenue guarantees, lifetime deals and custom builds to close the first customer. The existing referral benefit is already a meaningful incentive. The live [founding-operator programme](https://bookingtours.co.za/operators) separately includes a free first month and other cohort terms. Honour published commitments and confirm capacity/eligibility; do not automatically stack incentives. The current AI-led plan incorporates this discovery.

## 4. First 14 days: a concrete work queue

The dates assume a 17 September start; move the calendar if the payment or offer checks take longer. Cohort safety gates take precedence over dates.

| When | Owner/action | Evidence of completion |
| --- | --- | --- |
| Days 1–2, 17–18 Sep | Gideon: reconcile commercial terms; record current paying/active counts; check demo/calendar. Resolve the remaining payment journey using the existing runbook. | One written quote; baseline counts; recorded journey result, with test and real transactions distinguished. |
| Days 2–3, 18–19 Sep | Gideon: start with the seed list below, check fit and existing relationships; grow it to 30 named businesses. | Thirty rows with a real source, fit reason, permitted contact route and next action. No claim that they are interested. |
| Days 3–5, 19–21 Sep | Gideon: seek ten permissioned introductions through current operator relationships; attend suitable local business conversations. | Five discovery conversations booked is the target. Log refusals and non-response too. |
| Days 5–8, 21–24 Sep | Gideon: conduct five discovery/demo calls. Show one requested task, then quote and agree a next step. | Two suitable pilot commitments is the target; record why the other three did not proceed. |
| Days 8–12, 24–28 Sep | Gideon: onboard the first two using the [first-five checklist](../qa/FIRST_FIVE_CLIENTS_2026-09-13.md). | Owner logs in, one activity works, funds and notifications reconcile, operational task completed. |
| Days 12–14, 28–30 Sep | Gideon: check customer use, billing start dates and problems; request introductions only after an owner reports value. | Activated operators, marked free or paid based on collected invoices; documented objections; next cohort scheduled only if support is under control. |

Targets are hypotheses. Zero commitments after five demos means review the objections; it does not justify buying ads to hide the problem.

## 5. Days 15–90: repeat one sales routine

For this older, higher-effort scenario, work toward **five activated businesses by day 30; around thirteen by day 60; twenty to twenty-five by day 90**, with early customers reaching a second paid month when eligible. These are experiment targets, not a sales forecast. Founding and referral-free months delay the paid milestone: report those customers as activated/free until a software payment is actually collected. Use the smaller current targets at the top of this document for the AI-led plan.

Initial weekly allocation, 30 hours total:

| Work | Hours/week |
| --- | ---: |
| Research up to 100 suitable accounts and pursue lawful introductions/contact opportunities | 8 |
| Permissioned follow-ups and scheduling | 5 |
| Eight to ten discovery/demos, including notes | 5 |
| Two or three assisted onboardings and early customer check-ins | 8 |
| Partner conversations | 2 |
| Review the ledger and publish one useful proof item, if permissioned | 2 |

Fewer hours means a smaller target, not automatic outreach. Allow the public 90-minute onboarding expectation plus provider/setup delays. Early customers may consume more support; reduce new onboarding rather than skip checks.

Use this funnel only as a starting experiment:

`100 suitable businesses lawfully approached/week × 20% book a demo × 75% attend × 30% buy × 80% activate = 3.6 paid activated businesses/week (~15.6/month).`

Every percentage is unvalidated. “Approached” is a unique account with a permitted approach, not a scraped email address. Count actual delivery, opt-ins and refusals. Research and consent can make 100/week unattainable; replace the assumptions with measured rates after the first 50–100 eligible approaches. This example would produce fifteen attended demos/week, exceeding the initial eight-to-ten call allocation: if demand reaches that level, shift time from research to calls or offer a shared demonstration. The 90-day target is lower than a full quarter at the example rate because of startup time, capacity, collections and referral credits.

On discovery calls collect: current process; weekly enquiry/booking volume; biggest failure; required integrations; decision-maker; economic value; willingness to pay. If suitable, demonstrate enquiry → payment → booking → operational task. Then ask for a specific onboarding appointment, not a vague “let me know.”

## 6. Channels, in order of cash efficiency

**1. Existing operator relationships.** Ask satisfied owners for one introduction after their first successful week. The other owner should agree to be introduced before details are shared. One relevant introduction is more useful than a mass list.

**2. Local, individual prospecting.** Research public operator sites and learn the actual booking workflow. Use warm introductions, opt-ins, appropriate business visits and permitted community participation. Personalise around an observed activity, never an invented claim about lost bookings or dissatisfaction.

**3. Operator referrals.** The [published programme](https://bookingtours.co.za/refer) offers a free month to both parties when the referred operator signs up and takes its first booking. Honour the published commitment; clarify eligibility and how the credit is applied before enrolment. Do not quietly substitute a second-payment threshold. At the base price, two months of credits represent **R4,000 in potential subscription revenue forgone per referral**, plus service cost. Confirm whether extra seats are covered. Record it as acquisition cost, and do not stack another incentive on the same deal by default.

**4. Website agencies serving operators.** Pilot with two agencies after the first five customers succeed. They introduce a suitable client; you demonstrate and onboard; they keep their existing website relationship. Give them one demo, a fit checklist, the agreed pricing and an objection sheet. BookingTours' current [partners page](https://bookingtours.co.za/partners) sells its own marketing services; it does not establish reseller terms. Make the agency relationship clear so partners do not expect you to compete for their retainers.

Proposed agency economics, not an existing public offer: up to **R1,000 once** for a new business, payable after its second collected software invoice, subject to an agreed referral arrangement. No perpetual revenue share or partner portal initially. Pay from collected revenue; disclose the relationship where appropriate. Maintain attribution and avoid double-paying an operator referral and agency incentive for the same acquisition.

**5. Association sessions.** Propose a short practical session to SATSA's relevant chapter or a local operator association: demonstrate handling booking enquiries and a weather-disrupted day, then invite voluntary demos. Use the association's approved process; membership or a directory does not confer endorsement or permission to message members. Start with a free collaboration rather than sponsorship.

**6. Existing content and search.** Update one real operator story and reuse the existing demo and fee calculator. Record a short screen demonstration with synthetic data. Add content only for questions heard repeatedly from prospects. This is a supporting channel, not a forecast of free traffic.

Paid advertising stays at R0 initially. Consider a small, separately approved test only when one segment has repeatable paid conversions, retention and a working attribution process. Set a total loss limit and judge collected, retained customers rather than cheap lead forms. Avoid paid booths, purchased contact lists, outsourced bulk outreach and a new CRM subscription in the first 90 days.

## 7. Acquisition budget and actual cost

Cash acquisition ceiling, excluding current hosting/software operations, payroll, engineering, provider charges and non-cash referral credits. Any cash referral payout must fit inside this ceiling too:

| Item | Monthly maximum |
| --- | ---: |
| Local travel | R1,200 |
| Extra calls/data | R300 |
| Useful small business meetups | R500 |
| Reserve, including any agreed cash referral payout | R1,000 |
| Ads, lead databases, extra marketing software | R0 |
| **Total** | **R3,000** |

These are spending allocations, not vendor price quotes. Spend less when remote introductions work. First 90-day cash cap: **R9,000**. The existing operating bill continues separately. If R3,000 must also cover hosting and all business operations, subtract those actual bills first and reduce travel/meetups; do not exceed the total available cash.

For 25 paid activated customers, R9,000 / 25 = **R360 cash acquisition cost**, including any cash incentives within that cap. At 30 hours/week for 13 weeks and an illustrative R250/hour valuation of your time, founder labour adds **R3,900/customer**. Combined: **R4,260/customer**, before non-cash referral credits, attributable infrastructure and other omitted costs. If only five convert, the same spend/time costs R21,300 each. Low cash does not mean free.

Track acquisition cash and credits when committed and paid; a reward paid later is still a liability. Fully loaded acquisition cost includes sales/onboarding labour. Payback uses actual collected monthly contribution after variable service/support costs, not the R2,000 list price. Proposed scale gate: expected payback within three paid months, checked again with real 90-day cohorts. If the published referral incentive misses that gate, honour existing commitments and review future published terms.

After the first profitable cohorts, decide how much collected contribution to reinvest in channel/support costs. Keep the R3,000 acquisition cash cap until that decision; this plan does not authorise exceeding it. The scale scenario below requires more operating capacity and customer-funded spending than the initial budget. Add part-time help when onboarding queues or response times show an actual constraint and retained revenue can fund it. A permanent R3,000 total spending ceiling is not a credible assumption for operating 1,000 customers.

## 8. From fifteen to one thousand

| Milestone | What must become repeatable before expanding |
| --- | --- |
| 0 → 5 | Founder knows the buyer, completes setup personally and sees first customer payments. |
| 5 → 15 | Owners use it without daily rescue; early cohorts reach a second paid month; at least two permit a reference. |
| 15 → 50 | One segment converts consistently; two agency partners deliver actual customers; onboarding checklist has predictable effort. |
| 50 → 100 | At least one partner repeatedly sources and activates customers; support is funded; 90-day cohort retention is measured. |
| 100 → 300 | Several productive partners, group demos where appropriate, delegated standard setup, referrals with measured costs. Validate another region or adjacent simple activity segment. |
| 300 → 1,000 | Sufficient reachable market, sustained 50–75 gross paid activations/month, funded support and stable retention. Expand geography only when payments, currency and local operations actually support it. |

Market size is an unresolved constraint. The [SATSA directory](https://www.satsa.co.za/membership-directory/corporate) and [APA operator directory](https://apaseakayaking.com/operators/) are research starting points, not proof of 1,000 willing buyers. By 50 customers, build a deduplicated bottom-up estimate across activity types and regions, with actual suitability and price-acceptance evidence. If there are 5,000 reachable suitable buyers, 1,000 needs 20% penetration before allowing for churn; with only 500, the present segment cannot satisfy the target. Decide whether to broaden it or pursue a smaller profitable business.

Example channel capacity at maturity: **20 productive partners × two paid activations/month + ten founder/direct + ten referral/inbound = 60/month**. This is a requirement to validate, not a prediction. A partner with a signed agreement and no sales counts as zero. Do not count the same customer twice across channels.

At 60 new customers/month, two hours of setup each already requires 120 hours before support and selling. That cannot fit the initial founder schedule. Simplify/delegate setup and fund customer care before promising that volume; agency introductions alone do not solve onboarding capacity.

### Transparent growth arithmetic

For a first approximation:

`end-month customers = previous-month customers × (1 − monthly churn) + new paid activated customers`

Track seasonal pauses and reactivations separately in the real ledger. This simplified model holds them at zero, so it does not forecast seasonal full-price activity or cash receipts.

One deliberately ambitious scale scenario starts at zero, with 5/8/12 gross additions in months 1/2/3; then 12/month in months 4–6, 18/month in months 7–12, 30/month in months 13–24, 50/month in months 25–36 and 75/month afterwards. New additions enter at month end. At 2% monthly churn:

| End of month | Retained paying customers, rounded | Cumulative gross acquisitions |
| --- | ---: | ---: |
| 3 | 25 | 25 |
| 6 | 58 | 61 |
| 12 | 155 | 169 |
| 24 | 444 | 529 |
| 36 | 887 | 1,129 |
| 48 | 1,503 | 2,029 |

The model crosses 1,000 in **month 38**. With the same acquisition ramp, 1% churn crosses in month 37 and 4% in month 43. Those figures are conditional arithmetic, **not a validated 38-month forecast**; the acquisition ramp, market size, staffing and retention are all unproven. The older [finance plan](../finance/PLAN_2026-2031.md) had a much slower base case, reaching 592 tenants in five years. There is no evidence yet to replace that forecast with this faster scenario.

At 2% churn and 1,000 customers, twenty leave each month. Eight acquisitions/month tends toward only 400 customers; twenty/month approaches 1,000 asymptotically from below. The channel must improve substantially beyond the initial founder experiment. At the 60/month example rate, net growth at 1,000 would be about forty/month before seasonal pauses.

## 9. The ledger and stop/go rules

Use one existing spreadsheet or a simple table. Required columns:

`business | source URL | activity/region | fit or exclusion | decision-maker | contact permission/source/date | channel/referrer | stage | last action | next action/date | demo date | agreed monthly price | setup complete | first genuine booking | first software payment | second payment | credits/payouts | founder minutes | 30/60/90-day use | pause/churn reason`

Stages: researched → permissioned conversation → qualified → demo held → agreed → setup → activated/free or activated/paid → retained/paused/churned. Record one acquisition channel per commercial account. Keep a suppression list for objections. Use existing invoices and booking records to verify outcomes; a screenshot of a dashboard is not payment evidence.

Friday review, 30 minutes: record unique prospects approached, demos booked/held, paid activations, collection failures, early retention, total cash/credits, founder time and top three objections. Show cohort denominators, not just percentages.

| Signal | Decision |
| --- | --- |
| Under five genuine conversations from 50 eligible approaches | Rework targeting and contact route. Do ten discovery interviews before increasing outreach volume. |
| Fewer than two purchases from ten held, qualified demos | Review price, demonstrated value, trust and fit. Do not automatically discount or add features. |
| Fewer than four of the first five reach a real booking within 14 days of readiness | Investigate demand and setup friction; reduce onboarding intake. Do not count test bookings. |
| Fewer than four of the first five reach a second paid month, allowing documented referral credits | Speak to each owner; classify value, cash-flow, product and seasonal reasons. Small samples are directional. |
| At 20+ customers, under 90% of an eligible cohort retained at day 90 | Pause paid scaling and fix causes; show seasonal pauses separately. This is a proposed threshold, not an industry fact. |
| Onboarding queue exceeds five working days or support repeatedly exceeds capacity | Reduce intake and fund help from retained contribution. Preserve payment/security checks. |
| Payment, refund or customer-data incident | Address the affected workflow before increasing volume; use the existing operational runbooks. |

## 10. Initial prospect research: fifteen businesses

All researched on 17 September 2026. These are **potential accounts, not contacted, consented or qualified leads**. Public descriptions support the observations; fit and priority are my inferences. Check existing clients/relationships and common ownership before counting them. Public availability of contact details is not consent to marketing. Open the linked business page for its current official contact route; no bulk contact harvesting is needed.

“Explore first” means interview for fit, not confirmed eligibility. “Later” identifies likely complexity or switching costs that may make the business unsuitable for the first cohort.

| Business and source | Observed reason to investigate | Qualification focus / next action |
| --- | --- | --- |
| [Gary's Surf School](https://www.garysurf.com/) | Muizenberg surf lessons; times depend on tides. | Explore first: ask about one standard group lesson, coach capacity and setting daily times. Exclude camps/accommodation from pilot. |
| [Shoreline Surf School](https://www.shorelinesurfschool.co.za/) | Muizenberg surf lessons and lesson packages. | Explore first: establish volume and one-off lesson demand; verify package-credit needs before quoting. |
| [Up the Mountain](https://www.upthemountain.co.za/) | Guided Table Mountain routes with online date selection/payment. | Explore first: ask what current software fails to solve; check whether departures are public or private. |
| [Table Mountain Walks](https://www.tablemountainwalks.co.za/table-mountain-walks-pricelist/) | Published guided hiking products and per-person prices. | Explore first: confirm standard departures, minimum party size and monthly direct volume. |
| [Cape Town Climbing](https://capetownclimbing.com/) | Guided climbing, scrambling and hiking. | Explore first only if a repeatable day product fits; defer tailor-made guiding/quotes. |
| [Kayak Clifton — APA listing](https://apaseakayaking.com/operators/) | Listed by APA as a kayaking operator. | Directory evidence only: establish current official site, operation and owner; then qualify scheduled trips. |
| [Walker Bay Adventures — APA listing](https://apaseakayaking.com/operators/) | Listed kayaking operator. | Directory evidence only: verify the current operation and direct booking workflow before prioritising. |
| [Waterfront Kayak — APA listing](https://apaseakayaking.com/operators/) | Listed kayaking operator. | Directory evidence only: confirm identity/ownership and avoid duplicate targeting of related brands. |
| [Eden Adventures](https://eden.co.za/) | Wilderness canoeing, kloofing and canoe hire. | Second local cohort: start with one guided activity; verify whether rental availability needs differ. |
| [Untouched Adventures](https://www.untouchedadventures.com/) | Tsitsikamma kayak/lilo and snorkelling activities. | Later: ask about existing channels, guest rates and shared capacity before suggesting migration. |
| [Atlantic Outlook](https://www.atlanticoutlook.com/) | Daily kayaking/hiking; public booking links point to Activitar. | Later: existing software/distribution relationship. Establish direct-channel value and inventory separation; do not promise OTA replacement. |
| [Gravity Adventures](https://gravity.co.za/coasteering/) | Day activities; coasteering page links Activitar and shows group-based pricing. | Later: rate/minimum-group complexity; pilot only if an independently manageable simple product exists. |
| [Learn 2 Surf Cape Town](https://southafrica.learn2surf.net/school/cape-town/) | Open/private group lessons and coach ratios; the [FAQ](https://learn2surf.net/faq/) describes central bookings across schools. | Later: determine who buys centrally; one school is not automatically a separate customer. |
| [Fynbos Whisperer](https://www.fynboswhisperer.co.za/guided-private-hikes) | Tailored private guided hikes. | Later: private pricing and guide allocation may not fit. Interview before offering any setup. |
| [The Water Club](https://thewaterclub.co.za/) | Cruises, fishing and kayak hire across three Garden Route locations. | Later: multi-location/resources; qualify one operation and avoid assuming three separate subscriptions. |

First five to research further: Gary's, Shoreline, Up the Mountain, Table Mountain Walks and Kayak Clifton. Reorder immediately if a warm introduction or incompatibility changes the economics. The list establishes real organisations to investigate; it does not establish buying intent.

## 11. Five partner routes to investigate

| Organisation/source | Evidence and proposed approach |
| --- | --- |
| [SATSA Adventure Chapter](https://www.satsa.com/adventure-tourism) | Relevant operator community. Propose a practical educational session via the association's official process; no endorsement or free access assumed. |
| [APA Kayaking](https://apaseakayaking.com/operators/) | Published operator network. Explore an approved booking/admin demonstration for interested members. |
| [Kijo Digital](https://kijo-digital.com/) | Agency advertises travel/hospitality website work. Explore an introduction for one suitable activity client; protect the agency's services relationship. |
| [Digital Foundry](https://digital-foundry.co.za/web-design/cape-town) | Describes websites for small businesses including tourism operators. Ask whether it has suitable activity clients before discussing an agency pilot. |
| [Juicy Designs](https://www.juicydesigns.co.za/services/website-development-cape-town/) | Advertises tourism websites and booking integrations. Potential complement or competitor; test interest in a standard platform for smaller projects. |

No partnership, access to client lists, referral agreement or permission to use logos is implied.

## 12. Ready-to-adapt conversation copy

Use the email/message drafts only with an appropriate opt-in or permissioned introduction. South Africa's Information Regulator treats unsolicited electronic direct marketing as regulated; a public business address is not blanket consent and silence is not consent. Use its current [guidance](https://inforegulator.org.za/guidance-notes/) for any consent-request process and required form; do not treat cold calls or WhatsApp as a loophole. Maintain sender identity, contact details and opt-outs. These are sales drafts, not legal consent forms.

**Ask a satisfied customer for an introduction:**

> You mentioned that [specific workflow] is helping. Is there another activity owner who has the same problem? If they're interested, would you introduce us? I'll show them one relevant workflow. The referral benefit is explained here: https://bookingtours.co.za/refer.

**After the prospect agrees to the introduction:**

> Hi [name], thanks for agreeing to connect through [introducer]. I'm Gideon, building BookingTours for activity operators. I saw that you run [verified activity]. I'd like to understand how you handle enquiries and payments, then show the relevant workflow if it fits. Would a 20-minute conversation suit you? [verified discovery link]. If you prefer no further follow-up, just reply and I'll close the loop. Gideon — BookingTours — [business reply/contact details].

**Personalisation examples, after permission:**

> Gary's: “Your site says lesson times follow the tides. I'd like to understand how you confirm those times and collect payment for a standard group lesson.”

> Up the Mountain: “Your site already lets guests choose a hike and pay online. Is your remaining admin mainly enquiries, changes or organising the day?”

**Agency conversation, after an introduction/opt-in:**

> I'm looking for two agencies with activity-operator clients to test a referral arrangement. You retain the website relationship; we handle the BookingTours setup and software support. Could we assess one client together against the fit checklist? We can agree a one-off payment tied to collected subscriptions before making any referral commitment.

**Follow-up to someone who requested a demo/quote:**

> Based on our conversation, the useful starting point is [one activity/workflow]. The agreed monthly total would be [complete quote], with [provider dependency] still to complete. Would [date] work for setup, or should I close this for now?

Send a follow-up after roughly three business days and one final close-the-loop message a week later only within the prospect's permission/request. Stop immediately on refusal or opt-out. Do not chase an unanswered consent request with a sales sequence.

**Discovery demo outline, 20 minutes:** five minutes understanding the current workflow; eight demonstrating the relevant journey with safe sample data; four checking price, fit and dependencies; three agreeing a dated next step. Use the existing demo instead of building a bespoke site for every prospect.

**After successful activation:**

> Now that [specific booking/task] has worked, what still takes too long? Let's fix that before adding more activities. When you've used it for a full month, may we measure the change in admin time and write up the result for your approval?

Use actual measured results and customer-approved quotations in a case study. Do not recycle unsupported statistics from older marketing documents.

## 13. What was done in this session

- Reviewed the product, recent release/onboarding notes, historic financial baseline and current public offer.
- Researched fifteen potential operator accounts and five partner routes, with sources and fit limitations.
- Prepared the 14-day work queue, 90-day routine, budget, growth arithmetic, decision rules and conversation drafts.
- Checked the funnel, acquisition-cost and growth calculations with a one-off local calculation.

No prospects were contacted, accounts registered, paid services purchased, ads launched, production data changed or customers acquired. This file is the deliverable. The next real-world milestone is **two suitable operators agreeing to onboard**, followed by collected subscription revenue and successful customer bookings.
