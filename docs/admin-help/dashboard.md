---
title: Dashboard home
route: /
required_role: OPERATOR
---

The Dashboard is your at-a-glance cockpit for today: guests, booking value, and anything needing attention.

## Arrange your dashboard

**Main admins and super admins** can choose the sliders icon labelled **Edit dashboard** to move or hide tiles. Drag a handle, use the up/down buttons, or focus a handle and press the arrow keys. **Hide** moves a tile into **Hidden tiles**; choose **Show** to add it back.

Choose **Save layout** to keep the arrangement for this operator across devices and for the whole team. Hidden tiles stay hidden until a main or super admin restores them and saves. **Cancel** discards unsaved changes. Other admin roles can use the saved dashboard but cannot edit its layout. Read-only accounts cannot change it, and tile visibility does not change access to reports or other pages.

To return to the original dashboard, choose **Restore default layout**, then **Save layout**. This restores the original tile order and shows all tiles available to each user's permissions. You can choose **Cancel** before saving to keep the current arrangement.

If another admin saves while you are editing, reload their saved layout before making further changes.

## Today's numbers

The hero band shows **Today's guests** (guests departing today — click it to open Bookings) and a **Booking value** card with today, last-7-days, and this-month totals plus a daily sparkline (click through to Reports for detail). Booking value means confirmed bookings by their creation date, before refunds; it is not cash received. Open Reports for payments received and balances due. All dates use your business's timezone.

## Action cards

Three cards surface work needing attention, each linking to the right page:

- **Pending Refunds** — count and total value of refund requests waiting for a decision. Click to open the Refund Queue.
- **Inbox Action** — conversations where a customer is waiting for a human reply. Click to open the Inbox.
- **Photo upload backlog** — booked trips from the last 7 days with no saved photo links. Click to open Trip Photos. Saving links and sending them to guests are separate steps; this count is not proof that a photo email was delivered.

## Manifest and roll call

The **Manifest** and **Roll Call** panels sit below Today's guests and Booking value. Manifest shows the nearest booked departure time for today or tomorrow using the Today/Tomorrow toggle. Later departures stay hidden until they are next. The current departure stays visible for four minutes after its start time for check-in; then Manifest and Roll Call advance automatically. Activities leaving at the same time remain separate, and you can select which activity's guests to show in Roll Call. Use Bookings to view other departures. The dashboard refreshes automatically every minute, when bookings change and when the connection returns; the last-updated time remains visible.

Roll Call shows arrivals as a count out of the booking's group size. WhatsApp, phone and email icons sit beside the guest's name on mobile and desktop. WhatsApp and phone open the matching app when a valid number is available. In Roll Call, the email icon sends the booking's waiver when it is unsigned; once signed, it opens a normal email. It does not send a payment request. Its checkbox marks the whole group as arrived. The pencil beside the guest count opens that booking's **Guests arrived** field in Check-ins for a partial arrival or correction. Arrival recording still requires the booking to meet its payment and waiver checks. **Review booking status**, **Review payment**, and **Resolve waiver** open the section needed for the current blocker. Use **Add Booking** at the top of the dashboard for a walk-in.

## Simple View

Choose **Simple View** in the dashboard header for the phone and tablet workflow. [Today](/simple) and [Calendar](/simple/calendar) show booked sessions and their roll calls. The pencil beside the guest count opens [Check-ins](/simple/check-ins), where you can record money already received and partial group arrivals. **Full dashboard** brings you back here.

For guides who only need passenger totals and trip photos, the main admin creates a shared guide login under [Settings → Admin Users → Guide login](/settings#admins). It opens the restricted guide version of Simple View directly.

## Failed payment follow-up

**Payment recovery** sits just above Weather on the Dashboard and is also available below booked sessions in operator Simple View. It lists unpaid bookings, including failed Yoco payments, unfinished checkouts and unpaid manual bookings. The nearest upcoming departures appear first, followed by past trips. Expand or collapse a date or trip heading; each trip shows its departure time. Use **Email payment link** to send the secure Yoco checkout link. A rejection explanation is included only for a recorded payment failure. Availability and booking checks still apply. After Yoco confirms payment, the booking leaves Payment recovery; its payment status remains available in Bookings. Use **Refresh** for the latest result. The email's sent time records service acceptance, not a delivery receipt. Shared guide logins cannot use this panel.

For a direct client conversation, **WhatsApp** in Simple View's roll-call and payment-recovery rows opens your own WhatsApp. You write and send the message yourself.

## Weather

The Weather panel shows conditions for your location — useful when deciding whether to run, and pairs with the weather-cancel tools under Slots and Broadcasts.

## Welcome tour

On your first login a welcome tour walks through the dashboard. Main admins also get a getting-started checklist that responds as tours, slots and bookings are created. You can replay the tour from **AI help** in the dashboard header using **Show me around the dashboard**.

## Dashboard assistant and guest chatbot

The dashboard assistant explains where features are and how to use them. It uses the platform guide, not your live business records, so open the relevant page to read current totals or inspect a booking. In the live dashboard it can open pages and fill supported voucher or slot fields using values you provide. In the shared demo it explains actions and opens included pages without saving changes.

The customer website and WhatsApp chatbot is configured separately under Settings → Operations & AI Configuration and AI → Chat FAQ. Dashboard help is not billed against the customer chatbot's reply allowance.
