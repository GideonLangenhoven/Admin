---
title: Guide access and the Guide app
route: /guide
required_role: OPERATOR
---

For guides who only need expected passenger counts and trip photos, use the operator's **shared guide login**, which opens [Simple View](/simple) directly. The existing [Guide app](/guide) is a separate check-in workflow for dashboard staff; it is not the destination for a shared guide login.

## Existing Guide app for dashboard staff

Pick a date to see departures, guest and booking counts, and capacity. Tap a slot for its passenger list, customer notes, waiver status and arrival counts. **Check in** marks an eligible group present; **Check in rest** marks the remaining members of a partially arrived group. Payment and waiver checks apply. For entering or correcting a specific partial count, use [Simple View Check-ins](/simple/check-ins). Trip photos has its own link from the departure screen.

## Existing Guide app access

Any dashboard account (OPERATOR role or above) can use the Guide app. Add it to the phone's home screen for app-like access — it works as a PWA.

## Check-ins and the office

Saved check-ins update the main dashboard so the office sees who arrived. Offline operations can be queued, but must sync and pass the server's current checks; a queued local change is not confirmation that the office has received it. If a queued update conflicts with newer data, review the current count before retrying.


## Shared guide login for Simple View

The operator owner (MAIN_ADMIN or SUPER_ADMIN) creates **Guide login** under [Settings → Admin Users](/settings#admins). There is one shared login per operator, such as `guide@cape-kayak`, based on the operator's subdomain. The login stays the same if the operator later renames the subdomain. Ordinary dashboard staff must ask their main admin to manage this access.

Choose **Create guide login**, copy the private password setup link and share it with your guides. The guide follows the link and chooses a password of at least eight characters. The link expires after 48 hours and works once. Password setup signs the guide straight into Simple View. Afterwards they use the same shared login and chosen password on the normal sign-in screen.

Guides see passenger totals for each departure on their operator's selected day. Use the date arrows/date picker and **Refresh** to check another day or update the counts. **Trip photos** opens the departure's photo gallery and image upload control. Uploads use the operator's existing Google Drive connection. The shared login has no office dashboard, booking creation, check-in, payment, customer contact, marketing or customer-email controls. It cannot access another operator's trips.

The owner can disable guide access here. **Get fresh password setup link** replaces the previous link and requires the shared password to be set again. No password is displayed to the owner and no setup email is automatically sent to the guide username. Share setup links privately.

If the link expires or the shared password is forgotten, ask the owner for a fresh link. If access is disabled, ask the owner to enable it. Never paste a password or private setup link into AI help.
