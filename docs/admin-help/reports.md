---
title: Reports
route: /reports
required_role: OPERATOR
---

Reports gives you filterable, exportable views of your operation for bookkeeping, tax, and planning.

## Report tabs

- **Bookings** — booking and guest totals grouped by **Days**, **Weeks** or **Months**. Weeks start on Monday. The groups follow the selected tour-date or booking-date filter, in the business timezone.
- **Financials** — accounting view: gross booked, amount actually received, refunds, net received, and outstanding balances, with a per-booking payment method and payment reference.
- **Marketing** — bookings, guests and revenue by booking source.
- **Attendance** — who showed up. Guests on departures that haven't started yet count as Upcoming, not Not Arrived, and are left out of the attendance rate.
- **Waivers** — waiver completion.
- **Reviews** — moderate customer reviews by status. This uses the same Reports navigation, with **Pending**, **Approved**, **Hidden**, and **Spam** filters.

## Financials for accounting

The Financials tab reconciles money movement, not just booked totals: **Gross Booked** (the total of every booking in the period, cancelled ones included; the note under the tiles shows how much was cancelled), **Received** (cash and voucher value actually captured, including money taken on bookings later cancelled), **Refunded** (processed refunds), **Net Received**, and **Outstanding** (still due on bookings that are not cancelled). Every figure uses the report's date filter, by booking date or by tour date. Hover a tile to see its definition. Payments received with no gateway reference are flagged for audit. The Financials CSV is a full transaction ledger with every money column, payment references, voucher and promo details, OTA amounts, refund history, cancellation details and who took the booking.

**Revenue over time** appears only in Financials. It shows amounts actually received for bookings in the selected date range, grouped by the selected tour date or booking date. It is not a payment-date ledger.

## Accounting registers

On the Financials tab you can also export four registers for your accountant or an audit:

- **Refunds CSV** — every processed refund in the period with amounts, reasons and payment references.
- **Invoices CSV** — the invoice register in invoice-number order, with VAT numbers, payment method and reference per invoice.
- **Vouchers CSV** — vouchers sold in the period, vouchers redeemed in the period, and the open voucher balance (your outstanding liability).
- **Combo Settlements CSV** — amounts payable to and receivable from partner operators on combo bookings.

## Filtering and exporting

Filter the booking-based reports by date range, and choose whether the range applies to the **tour date** or the **booking date** — revenue by trip day and revenue by sale day are different views, pick the one your accountant wants. Export the filtered data as **CSV** (for spreadsheets) or **PDF**. Reviews uses status filters instead of date ranges and exports.

The Bookings CSV and PDF use the same day, week or month summary shown on screen. Use Financials for the detailed transaction ledger.

## During suspension

The current sign-in gate can block Reports when a subscription is paused or suspended. MAIN_ADMIN can reach Billing; contact BookingTours support if you need an export while operational access is blocked. Do not assume an export is available simply because the report itself has download controls.
