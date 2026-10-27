---
title: Settings
route: /settings
required_role: MAIN_ADMIN
---

Main admins can choose **Add admin** at the top of Settings to open the invitation form inside **Admin Users**. Enter the admin's name and email, then choose **Add Admin and Send Setup Link**. The plan's seat limit still applies.

Settings is one page of collapsible sections covering your whole configuration. It's visible to MAIN_ADMIN and above — though a MAIN_ADMIN can grant a regular admin access to specific sections (per-section settings permissions), in which case that admin sees only their granted sections.

## Admin Users

Add dashboard users (they receive a password-setup email), resend setup links, remove admins, and grant per-section settings permissions. The Main Admin account can't be deleted. This section also lets you suspend or reactivate the subscription.

Main Admins and Super Admins can select **Edit contact details** under an administrator to change their **Name**, **Email address** and optional **Phone number**. Main Admins can edit their own account and other admins within their business; platform Super Admin accounts remain restricted. **Save contact details** keeps the same account and permissions. A new email becomes the sign-in and account email immediately, with the existing password. Old password setup links expire; for an account still awaiting password setup, choose **Send setup link** after saving. The phone number is a contact field, not a phone sign-in. Customer-facing business contact details are edited separately under Booking Site Configuration.

The **Billing contact** selector chooses who receives BookingTours subscription invoices. By default they go to the first admin created on the account; pick any other admin to redirect them.

## Shared Guide login

Under **Admin Users → Guide login**, a MAIN_ADMIN or SUPER_ADMIN selects **Create guide login**, then copies and privately shares the one-use password setup link. It expires after 48 hours. A guide opens it and chooses the shared password; there is no automatic setup email to the guide alias. One `guide@operator-name` login serves all guides for this operator, based on its subdomain, and stays the same after a subdomain rename.

After setup, guides use that username and password on the normal sign-in screen and go directly to [Guide Simple View](/simpleguide). The roll call shows expected passenger totals, client contact links and check-ins. **Trip photos** on a departure opens the same Photos workspace as the full dashboard: image/video uploads through the operator's connected Google Drive, individual or bulk photo links, recent galleries, and **Send photos and thank you email**. Confirming sends the existing photo/thank-you email and WhatsApp photo message to eligible lead bookers for that trip. Guides cannot open office or marketing settings, create bookings, record payments, change the Drive connection or choose arbitrary recipients. This is separate from adding an ordinary dashboard admin and from the existing /guide check-in app.

Use **Disable guide access** or **Enable guide access** to change availability. **Get fresh password setup link** replaces the prior link and requires the shared password to be set again, including when it is forgotten. Do not ask guides to share passwords or private setup tokens in chat.

## Tours & Activities

Create and edit tours, descriptions, duration, departure schedules, default capacity, base and peak prices, images and confirmation taglines. Drag to reorder the booking-site cards. Activate/deactivate and show/hide control sales and public visibility; neither action cancels existing bookings. Tours with booking history or linked active vouchers cannot be deleted.

Departure times use a **24-hour clock** in the operator’s saved timezone (SAST for South Africa). Type **1800** continuously to enter **18:00**, or **0930** for **09:30**, without selecting AM/PM. For a **2-hour, 30-minute** tour, select **hours**, enter **2**, and enter **30** in the adjacent minutes field. Existing durations load into the matching hours and minutes when edited; whole-day tours still support **days**.

When generating slots, choose **Date range** for a repeating weekday schedule or **Specific dates** to pick individual tour dates. Add as many dates and departure times as needed. Each departure time is created on every selected date, and existing departures are skipped. For a new tour, the selected schedule is generated when you choose **Add Tour**; for an existing tour, choose **Generate Slots**.

**Last-minute deals** have a deal price and a start/end window measured in hours before departure. They apply to eligible unsold availability, not refunds on an existing paid booking. Upcoming departure-time bundles can also be managed here; [Slots](/slots) has the full calendar and bulk tools.

**Custom Booking Questions** is in [Tours & Activities](/settings#tours). Add a template or a question, choose its answer type, options and required status, then save. The answers are captured with the booking and shown to staff; these questions are not in Booking Site Configuration.

## Booking Add-Ons

Optional extras customers can add at checkout (photo packages, equipment hire). Create, edit, and drag-reorder.

## Booking Site Configuration

Your customer-facing booking site's policies, directions, branding, background and hero text, navigation, button and footer copy, theme colours, contact links, timezone, chatbot avatar and cancellation policy tiers. Refund percentages are set in **Settings → Booking Site Configuration → Cancellation Policy**: each tier is the hours of notice before the trip and the percentage refunded, plus the policy summary guests and the chat assistants see. The booking-site preview shows the effect of the settings, including theme text contrast. Custom checkout questions are maintained under Tours & Activities.

## Embed Widget

A copyable snippet to embed your booking widget on your own website.

## Email Customisation

Per-email-type colour themes and banner images for the emails customers receive (confirmations, invoices, cancellations, photos, and so on).

## Operations & AI Configuration

Arrival instructions, what to bring and wear, FAQ answers, and the AI chatbot's personality and business knowledge. This content feeds the customer website and WhatsApp assistant; arrival and packing instructions also feed guest emails. It does not change the dashboard help assistant's product guide. Staff with the **Booking Site Config** grant can also manage this section and Embed Widget.

## WhatsApp Bot Mode

Controls WhatsApp auto-replies: **Always**, **Outside business hours**, or **Never**. Outside-hours mode uses the saved weekly schedule and business timezone. Human takeover on an individual conversation still takes precedence. This section requires a main admin; ordinary Settings grants do not unlock it.

## Dashboard Preferences

Show or hide **Help assistant bubble** for your own admin account. This preference follows your account across devices and does not change another staff member's preference or disable the customer chatbot. In the current dashboard, the assistant opens from the header's AI help control.

## Automation Tag Rules

Rules that automatically tag marketing contacts based on booking behaviour (for example tag customers who booked a specific tour), for targeting campaigns.

## Invoice & Banking Details

Company information and EFT banking details printed on customer pro forma invoices. Staff granted **Invoice Details** can edit the permitted company fields. Banking details require MAIN_ADMIN or SUPER_ADMIN.

## Integration Credentials

WhatsApp (access token and phone number ID), Yoco payments (live keys plus a test mode toggle), and Google Drive connection for trip photos. Credentials are encrypted at rest and can only ever be edited by MAIN_ADMIN and above — this section is never delegatable to sub-admins.

To change WhatsApp, Yoco live, or Yoco test credentials, enter both new values and save. To clear saved details, choose **Remove configuration** on that integration and confirm. Its status changes to **Not set**, and you can save new credentials afterward. Removal stops the affected messages or payments until you reconnect; existing bookings and payment records remain saved. Removing Yoco test credentials leaves the current payment mode unchanged, so it never switches you to live payments. Google Drive has its own **Disconnect Google Drive** button.

BookingTours must first connect your WhatsApp Business Account to its shared Meta app. Ask the BookingTours onboarding team to do this with you; a token from a separate Meta app will not work with the bot. The Phone Number ID is the numeric ID shown for your number in WhatsApp Manager (or in the connected app's WhatsApp API Setup), not the displayed phone number or the WhatsApp Business Account ID. For production, BookingTours generates a system-user access token for its app with `whatsapp_business_messaging` and `whatsapp_business_management` access to your account. The token displayed in API Setup is temporary and should not be saved here.

## Saving banking and integration settings

All accounts, including platform Super Admins, use their normal sign-in to save banking details, WhatsApp credentials, Yoco credentials and Yoco test mode. No authenticator setup or code is required. Existing role permissions still apply: these settings are managed by the account owner (MAIN_ADMIN). Platform Super Admins do not need an authenticator either.

## Chat FAQ (Quick Answers)

Open [AI](/ai-usage) in the Growth group, then its **Chat FAQ** tab at /settings/chat-faq. Quick Answers are not a Settings section. This page requires a main admin.

## Data Requests and unavailable connections

Main admins reach [Data Requests](/privacy/data-requests) from the link at the bottom of Settings. OTA Channels currently says direct Viator and GetYourGuide connections are not available yet. Do not try to configure them as live integrations. Operator ChatGPT/MCP and Meta Muse connections are also not customer-available; they are separate from the built-in dashboard and guest assistants.
