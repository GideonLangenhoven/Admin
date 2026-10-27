---
title: Simple View, roll call and check-ins
route: /simple
required_role: OPERATOR
---

Choose **Simple View** in the full dashboard's header for the phone and tablet operations workflow. Its navigation has **Today**, **Add walk-in** and **Full dashboard**. **Full dashboard** returns to / for scheduling, refunds, marketing and configuration.

## Today and Calendar

[Today](/simple) opens **Roll call** for the current business date. Payment recovery sits below the heading and works the same as on the dashboard. The roll call shows the next booked departure, keeps it available for four minutes after its start, then advances to the next departure. If trips leave together, use the departure arrows to switch between them. Use the day arrows or date picker for another day. [Calendar](/simple/calendar) shows all of that selected day's booked sessions in time order. These screens show sessions with bookings, not every empty departure in the full Slots calendar. Guide Simple View continues to show all booked sessions for the selected day.

Each session shows its time, activity, booked and arrived guests, and available places or a Full, Closed, Cancelled or Departed label. Its roll call shows each lead booker and arrival count. The pencil beside the guest count opens that booking's arrival field in Check-ins. WhatsApp, phone and email icons sit beside the guest's name on mobile and desktop, including in Check-ins. WhatsApp and phone require a valid phone number; email requires a valid email address. In Roll Call, the email icon sends the booking's waiver when it is unsigned; once signed, it opens a normal email. It does not send a payment request. The same contact icons are available on payment-recovery rows. South African local numbers are converted to +27 automatically. You write and send the message yourself.

Simple View updates automatically when bookings change, every minute, when the connection returns, and when you return to the browser window. There is no timezone/update row or Refresh day button.

## Payment and waiver readiness

[Check-ins](/simple/check-ins) shows the payment and waiver status before recording arrivals. If money has actually been received offline, choose **Cash**, **EFT**, **Card (terminal)** or **Other**, add a payment note or reference, and record it. Wait for the refreshed booking to confirm payment. A pay-on-arrival exception alone is not a recorded payment.

A signed waiver and payment in full are required before adding arrivals in Simple View. Account/reseller approval and Allow Without Payment do not bypass this requirement. Check the displayed blocking reason if the control is unavailable. Correcting an existing arrival count downward remains possible. Recording a payment does not collect a card payment through Yoco.

## Partial group arrivals

Select the pencil beside the guest count in Roll Call to open that booking's **Guests arrived** field in Check-ins. Use the minus/plus controls to set the number actually present, from zero up to the booked group size, then save. For example, record 2 of 4 arrived when half the party is present. Correct a mistaken arrival count here as well. The Today/Calendar roll-call checkbox marks the whole eligible group present or resets a fully present group.

## Walk-ins and the shared demo

Choose **Add walk-in** in the header. The form at /simple/new-booking carries the selected date or departure. Use the **X** beside the Add walk-in heading to close the form and return to the screen and date you came from. Review the adult/child counts, extras, payment action and any required booking or participant questions before choosing Create. Draft details survive closing, Back and Cancel within the same authenticated browser tab. Capacity and normal booking checks still apply.

The shared demo explains operations without committing payments, arrivals or new bookings. Use the full dashboard's AI bot for its product tour.


## Guide-only access

Guides use the operator's shared `guide@operator-name` login and chosen password. This opens [Guide Simple View](/simpleguide) directly, with the roll call, client contact buttons, expected passenger counts and check-ins for the selected day. Use the date arrows or date picker to choose a day; its data refreshes automatically. **Trip photos** opens the same Photos workspace as the main dashboard, preselected for that departure. Guides can upload images/videos, paste or bulk-import links, review recent photo links, and confirm **Send photos and thank you email** to notify that trip's lead bookers. Access is limited to the guide's operator; Full dashboard, walk-ins, payment recording and marketing campaigns remain unavailable.

The operator owner sets up this login in [Settings → Admin Users → Guide login](/settings#admins), chooses **Create guide login**, and privately shares the one-use password setup link. It expires after 48 hours. A guide chooses the shared password once and is signed directly into Simple View. After that, all guides use the shared username and password on the normal sign-in screen. The owner can disable access or issue a fresh setup link when the password is forgotten. Shared guides can send trip photos and the existing thank-you email for their own operator's trips.
