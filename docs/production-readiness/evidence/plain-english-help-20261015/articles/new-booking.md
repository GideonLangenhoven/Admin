---
title: New Booking
route: /new-booking
required_role: OPERATOR
---

New Booking creates a booking on behalf of a customer — walk-ins, phone bookings, or corporate groups.

## Creating a booking

1. **Activity Details** — choose the tour and number of guests. Slot Availability shows open departures; pick one.
2. **Customer Details** — name, mobile number (you'll be asked to confirm the number is correct — it's used for WhatsApp), and email.
3. **Optional Add-Ons** — extras like photo packages or equipment, with quantities; these add to the total.

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
- **Record payment already received** records money actually collected, with its method and reference. It does not charge a card through Yoco.

Use **Review booking** to check the selected departure, adult/child counts, extras, required participant answers and final total, then **Create Booking**. The receipt distinguishes total, paid and due amounts and reports the notification result. A lost response is not proof that saving failed; use the save reference to inspect the booking before starting another one.

## Price unavailable

A missing, negative or invalid configured tour/departure price blocks booking creation and shows **Price unavailable**. Ask an admin to correct the configured pricing, then refresh. Do not treat missing pricing as a free booking.

## Hold duration

A pending manual booking holds its seats for the **Hold booking for** duration you select (default 24 hours). If payment is not received by the deadline, it can expire and release the seats. On [Bookings](/bookings), use **Allow Without Payment** for an approved pay-on-arrival exception, or **Require Payment** to restore normal expiry and reminders.

## Walk-ins from Simple View

Use **Add walk-in** in Simple View, or **Book** on an available session, to open /simple/new-booking. The form uses the selected date or departure where provided and can return to the original Simple View screen after saving. A full or closed departure cannot accept an additional booking.
