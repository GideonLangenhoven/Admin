# Daily work quick start — local pilot candidate

This guide describes the synthetic-tested candidate. Use the isolated practice demo for training; the normal product has real inventory and integrations. A payment sandbox banner alone does not isolate guest messages.

## Frontline staff / guides

1. Open **Simple View → Today**. Check the selected date, operator timezone and last-updated time. If the day is unavailable, refresh; do not interpret missing data as no guests.
2. Find the departure by activity **and** time. Booked people include temporary payment holds; available places follow the shared capacity service. Open the correct party by booking reference/details when names repeat.
3. For an arrival, check payment and waiver separately. Use the booking-specific resolution link. A missing signed booking waiver blocks arrival; inspect signer/participant information against the operator's requirements.
4. A balance due requires payment recorded or an existing admin account/reseller approval. Ask an admin if approval is needed. Do not change a status to bypass the rule.
5. Return to the original day/slot after resolving the booking, refresh and record the actual number present. Report a failed/stale correction instead of repeatedly starting a new action.

## Bookings staff

1. Use a departure's **Add walk-in** when possible. Otherwise choose the real activity, date and departure; check timezone and places available. No alternative is selected silently.
2. Enter adult/child counts, minimum contact information and every configured booking/participant question. The payer's answer does not replace another guest's required answer.
3. Select extras and the genuine payment action: **Request payment**, **Hold places**, **Confirm with balance due**, or **Record payment already received**. Recording existing money does not charge a card. A confirmation can still owe money.
4. Open **Review booking**. Check departure, party, price, safety details, payment effect and immediate notification recipients. Uncheck the immediate-message option if appropriate; scheduled messages still follow existing settings. Review itself saves nothing.
5. Choose **Create Booking** once. Read the saved reference, total/paid/due and notification result. If the response is uncertain, retry the same details or open the displayed reference. Do not start a fresh booking to recover a lost response.
6. **Bookings** reuses the full search. Check departure/date/status and reference before editing a similarly named guest. Use Full dashboard for specialist functions.

Unsaved edits survive Cancel/Back in the same signed-in tab. They do not survive reload/logout and expire on later access after 20 minutes of inactivity. No guest/safety draft is written to local/session storage.

## Admin / owner

- Approve an unpaid account/reseller arrival only after checking the arrangement. Open its booking, enter the account/reseller reference and reason, and explicitly approve. All admin levels may approve; guides/OPERATOR cannot grant approval. Revocation is recorded; moving departures invalidates approval. Waiver is still required.
- Use Slots for existing future-session/capacity tools. Advanced pricing, bookings, finance and marketing remain in the full dashboard; Simple is optional during the pilot.
- For an exception, inspect the exact booking history and error, then ask the main admin with the booking reference and task context. Avoid copying health, child, waiver or payment details into support notes.

Before using this candidate live, complete the release gates in [the implementation report](IMPLEMENTATION_20261015.md). No live pilot, messages or support promises have been established by this work.
