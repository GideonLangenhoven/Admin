# Onboarding the first five clients — 13 September 2026

Use this checklist separately for each business. Allow about 30–45 minutes for
an assisted setup, with extra time if payment or WhatsApp accounts need attention.
The release verification result belongs in `ROLLOUT_REMEDIATION_2026-09-06.md`;
this guide is not itself a launch approval.

## Before each appointment

Ask the owner to bring their business name, preferred booking-link name, owner
email, logo, tour prices, duration, maximum guests, operating times, meeting
point and cancellation policy. Ask them to have access to their own Yoco account.
Keep secret keys and passwords out of email, chat and shared onboarding notes.

Ask which WhatsApp number they want customers to use and whether they already
use it on a phone. Preserve their existing account and chat history while its
Meta connection is arranged; do not delete an account to rush onboarding.

## 1. Create a separate business

Sign in with your platform-owner account and open **Super Admin**. For an
assisted setup use **Onboard New Client**. Alternatively, **Onboarding Invites**
creates a link through which the owner fills in their own business details.
Choose one route per client; do not create a second business if setup is interrupted.

Give each business its own name, subdomain and main administrator email. The
client owner gets **MAIN_ADMIN** access. Reserve **SUPER_ADMIN** for your platform
team because it can access every business. Additional staff should have their
own accounts and only the permissions they need.

## 2. Have the owner sign in

Send their password-setup invitation from the app. Let the owner choose their
own password and sign in on their own device. If the email is missing, check
spam and resend the existing account's setup link; do not create another account.

Confirm that the dashboard shows their business name. When you support them
from your own account, select their business before making any changes.

## 3. Set up one activity together

In **Settings → Tours & Activities**, enter one real activity, its price,
duration and capacity. Generate future departure dates and times. Confirm the
timezone, meeting point, directions, things to bring and cancellation policy.
Make the activity visible and ensure there is an OPEN future departure with
available seats. Open the actual booking link shown by the app and check the
price, time, logo and contact information with the owner.

## 4. Connect that business's payments

In **Settings → Integration Credentials**, use this client's own Yoco account.
Check both the payment key and the payment-notification connection. A saved
key alone does not prove that a paid booking will be confirmed.

Run the test-mode checks first. Before accepting customer money, verify the
live key and live webhook, and ensure the business is no longer in TEST MODE.
Agree with the owner before making any small real-card transaction; mark a
booking paid manually only when money was actually received through that channel.

## 5. Prove one complete customer booking

Using an approved test email and phone, open the public booking link, choose the
activity and pay through the checkout. Confirm all of these together:

- The amount and business shown on checkout are correct.
- The customer returns to a confirmed booking with the correct date and guests.
- The booking appears once in this client's dashboard and uses the right number of seats.
- The confirmation email arrives with this client's name, meeting point and links.
- A test amendment and refund show the right amount and finish successfully.

A manually created PAID booking does not test the online payment connection.
If payment or confirmation fails, keep the public link unshared until it works.

## 6. Connect and test WhatsApp

Save this client's own WhatsApp connection. Send test messages only to an
approved recipient. Check that a customer reply reaches this client's inbox,
and that replies, booking links and business details are correct. If Meta setup
is still pending, explain that clearly and agree on email/phone support until
the WhatsApp connection is ready. Do not promise a working bot before this test.

## 7. Check separation, then hand over

Use the client's own login, not your SUPER_ADMIN account, for this check. Confirm
that bookings, customer details, inbox, vouchers, reports and settings belong
only to them. Repeat in a separate browser session for the next client. The same
person may book with two businesses; each business should see only its own
relationship with that customer.

Show the owner how to find a booking, check someone in, change a booking,
handle a cancellation/refund and contact you. Give them their exact dashboard
and public booking links from the app. Check in after their first real booking
and again the next morning.

| Client | Owner signed in | Booking/payment verified | Email received | WhatsApp verified or explicitly pending | Separation checked | Public link approved |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |

During the first week, check failed payments, refunds awaiting confirmation,
message failures and departure capacity at the start and end of each day.
Resolve a problem for the affected business before onboarding the next one.
