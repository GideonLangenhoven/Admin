---
title: Simple View, roll call and check-ins
route: /simple
required_role: OPERATOR
---

Choose **Simple View** in the full dashboard's header for the phone and tablet operations workflow. Its navigation has **Today**, **Add walk-in** and **Full dashboard**. **Full dashboard** returns to / for scheduling, refunds, marketing and configuration.

## Today and Calendar

[Today](/simple) opens **Roll call** for the current business date. Use the arrows or date picker for another day. [Calendar](/simple/calendar) also shows that selected day's booked sessions in time order. These screens show sessions with bookings, not every empty departure in the full Slots calendar.

Each session shows its time, activity, booked and arrived guests, and available places or a Full, Closed, Cancelled or Departed label. Its roll call shows each lead booker, group size, payment readiness and arrival count. Use **WhatsApp** to open a chat with the client in your own WhatsApp, or **Call** to dial their number. WhatsApp is also available on payment-recovery rows. You write and send the message yourself. A valid phone number is required; South African local numbers are converted to +27 automatically. **Check-ins** opens that session's arrival workflow; **Book** appears only when it can accept another booking.

## Payment and waiver readiness

[Check-ins](/simple/check-ins) shows the payment and waiver status before recording arrivals. If money has actually been received offline, choose **Cash**, **EFT**, **Card (terminal)** or **Other**, add a payment note or reference, and record it. Wait for the refreshed booking to confirm payment. A pay-on-arrival exception alone is not a recorded payment.

A signed waiver and settled payment are required before adding arrivals. An admin may explicitly approve an account or reseller arrival with a reference and reason; the waiver is still required. Allow Without Payment alone is not this approval. Check the displayed blocking reason if the control is unavailable. Recording a payment does not collect a card payment through Yoco.

## Partial group arrivals

Use the minus/plus controls to set the number actually present, from zero up to the booked group size, then save. For example, record 2 of 4 arrived when half the party is present. Correct a mistaken arrival count here as well. The Today/Calendar roll-call checkbox marks the whole eligible group present or resets a fully present group; use Check-ins for precise partial counts.

## Walk-ins and the shared demo

Choose **Add walk-in** in the header or **Book** on an available session. The form at /simple/new-booking carries the selected date or departure and returns to the appropriate screen after saving. Review the adult/child counts, extras, payment action and any required booking or participant questions before choosing Create. Draft details survive Back and Cancel within the same authenticated browser tab. Capacity and normal booking checks still apply.

The shared demo explains operations without committing payments, arrivals or new bookings. Use the full dashboard's AI bot for its product tour.


## Guide-only access

Guides can use the operator's shared `guide@operator-name` login and their chosen password. This opens Simple View directly, with **Expected passengers** for the selected day and **Trip photos**. Use the date arrows/date picker or **Refresh** to update the view. The guide navigation has **Today**, **Trip photos** and **Sign Out**. This is limited to the guide's operator; it does not include Full dashboard, walk-ins, check-ins, payment recovery or customer contact actions.

The operator owner sets up this login in [Settings → Admin Users → Guide login](/settings#admins), chooses **Create guide login**, and privately shares the one-use password setup link. It expires after 48 hours. A guide chooses the shared password once and is signed directly into Simple View. After that, all guides use the shared username and password on the normal sign-in screen. The owner can disable access or issue a fresh setup link when the password is forgotten. Shared guides view/upload photos but do not send customer emails.
