---
title: New Booking
route: /new-booking
required_role: OPERATOR
---

New Booking creates a booking on behalf of a customer — walk-ins, phone bookings, or corporate groups.

## Creating a booking

1. **Departure and party** — choose the activity, date, departure time and number of guests. Open **Compare nearby dates** to check other departures.
2. **Guest and contact details** — the full name and a valid email address are required. Mobile number is optional. Payment notices and waiver requests use the guest’s saved email address.
3. **Optional extras** — extras like photo packages or equipment, with quantities; these add to the total.

Complete the custom booking questions configured for the activity and review the total before saving. Questions are maintained under Settings → Tours & Activities, not Booking Site Configuration.

## Discounts and promo codes

Under **Price Adjustment** you can apply:

- **Manual discount** — reduce the price by an amount; a reason is required and recorded against the booking.
- **Promo code** — validated live; supports percentage or fixed-amount codes.

Add-on revenue is preserved even when a manual discount is applied — the discount applies to the tour price.

## Taking payment

Choose **Payment action**:

- **Request payment** sends the customer a payment request; money is still due until payment is confirmed.
- **Hold places, no immediate message** reserves places until the hold deadline without an immediate notification.
- **Confirm booking, money still due** confirms the reservation without recording a payment. Check-in still requires payment and a signed waiver, or an explicit account/reseller approval plus the waiver.
- **Payment received** records the full booking amount as already collected. It does not charge a card through Yoco.

Use **Review booking** to check the selected departure, adult/child counts, extras, required participant answers and final total, then **Create Booking**. After saving, Bookings opens on the departure date with the new booking highlighted and its departure expanded. Guest message results appear as notifications. A lost response is not proof that saving failed; use the save reference to inspect the booking before starting another one.

## Price unavailable

A missing, negative or invalid configured tour/departure price blocks booking creation and shows **Price unavailable**. Ask an admin to correct the configured pricing, then refresh. Do not treat missing pricing as a free booking.

## Hold duration

A pending manual booking holds its seats for the **Payment due within** duration you select (default 7 days). If payment is not received by the deadline, it can expire and release the seats. On [Bookings](/bookings), use **Allow Without Payment** for an approved pay-on-arrival exception, or **Require Payment** to restore normal expiry and reminders.

## Walk-ins from Simple View

Use **Add walk-in** in Simple View or on a departure to open /simple/new-booking. The form uses the selected date or departure where provided. Creating the booking opens it in the Bookings tab; cancelling returns to the original screen. Admins can use **Override departure and capacity** to add guests to a full or closed departure.


## Extra pax and departure overrides

Admins can always choose **Extra pax** under **Activity**. Enter the number of adults and children, any departure date and time, and the **Total price (R)** for the group. There is no 50-guest limit in this mode. Zero is accepted for a complimentary booking. Optional extras are added to that price.

For an existing activity, tick **Override departure and capacity** to enter the date, time and agreed price yourself. A matching departure receives the extra guests even if full or closed; otherwise a departure is created. Existing guests keep their booking details. Times use the operator’s timezone, including when recording a past departure.

Choose **Confirm booking, money still due** or **Payment received**, then review and create. The booking appears in Bookings, the dashboard manifest and Simple View (including guide access) on its departure date. Required booking questions, payment and waiver checks still apply. Extra pax is an internal activity and is not added to the public activity catalogue. Newly created bespoke departures are closed to online bookings.

Manual bookings default to a seven-day payment window. You can choose 2, 6, 12, 24, 48, 72 or 168 hours. Payment holds end at least one hour before departure; confirmed bookings are due by departure if sooner. Admin departure overrides use the selected window. Payment emails show the saved deadline in the operator’s timezone.

For unpaid manual bookings with a payment link and a window longer than 24 hours, a single email reminder is queued 24 hours before payment is due. It warns that the emailed payment link will expire. Paid, cancelled, expired and pay-on-arrival bookings are excluded; each delivery attempt rechecks the saved booking. Shorter windows cannot receive a reminder 24 hours in advance.

To request the waiver manually, open the booking, go to **Waiver & Intake**, and choose **Send waiver by email**. The request goes to the saved guest email and uses the booking-specific waiver link. Already signed waivers do not need another request.
