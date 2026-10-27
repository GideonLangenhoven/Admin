---
title: Marketing
route: /marketing
required_role: OPERATOR
---

Marketing is your email-marketing hub: contacts, templates, campaigns, automations, and promotions, with an analytics overview.

## Setting up email sending

Marketing checks email setup for the selected operator. **Marketing emails need setup** lists the remaining work for BookingTours: the email connection, bounced-email and spam reports, the operator’s local time zone if missing, and enabling sending for the operator. **Email BookingTours** opens a support email with the operator and current setup steps; review and send it yourself. **Review contacts** opens customer permission records. You can still save and preview drafts.

When setup is ready, Main Admin and Super Admin can activate email-only welcome and welcome-back sequences after reviewing them. Sending uses the operator’s local hours (currently 08:00–20:00) and at least 24 hours between marketing emails to the same contact across campaigns and sequences. If setup cannot be checked, choose **Check again**; the dashboard does not assume your setup is incomplete.

Select **Review contacts** to open the contact list. A contact who needs permission checked does not yet have a confirmed record of agreeing to marketing emails. Adding or importing their email address is not enough. Main Admin or Super Admin can open the contact’s history, choose **Record existing permission**, and enter when permission was given, the wording shown and an evidence reference. This records existing permission; it does not obtain permission for you. Unsubscribes, bounces and spam reports remain excluded.

## The overview page

The landing page shows Active Contacts, Templates, Emails Sent, and Campaigns, an **Email Usage This Month** meter (emails sent versus your plan's included quota, with overage cost projection), and charts for engagement (open, click, unsubscribe, bounce rates), campaign performance, audience breakdown, and open-rate trend.

## Contacts

Use the **Contacts** tab to manage your audience. **Templates**, **Automations**, **Promos** and **Vouchers** are the other tabs in Marketing. Automatic tag rules in Settings can segment contacts based on booking behaviour. Campaign sending requires eligible active contacts with marketing consent; unsubscribed contacts are excluded.

## Templates and campaigns

Design reusable email templates under Marketing → Templates and preview them before preparing a campaign. Campaign delivery requires configured sending and contacts with recorded marketing permission. Promotional test sends remain unavailable; use the on-screen preview. A scheduled campaign can be **cancelled** and a sending campaign **paused** from Recent Campaigns on the overview. These controls stop remaining sends; emails already delivered cannot be recalled.

## Automations

In **Automations → Suggested email sequences**, choose **Ask for reviews**, **Welcome new enquiries** or **Invite customers back**, then **Preview sequence** to see the emails and timing before creating a draft. The count shows matching contacts, not emails sent or an active automation. The initial Invite customers back count uses 90 days since the last paid booking; adjust timing in the saved draft. **Voucher expiry reminders** are listed here as unavailable. **View vouchers** opens the voucher list for manual review.

Under Marketing → Automations you can draft triggered emails, for example a message a number of days before or after a booking date, birthday offers, or win-back campaigns. Browse Templates for ready-made flows (welcome series, post-tour review requests, win-back campaigns and more) that come with designed emails already linked, or start from scratch. Automatic voucher/promo issuance, date-based triggers and event-tag journeys remain unavailable. Welcome and welcome-back starter drafts contain emails and delays without automatically created discounts.

Every step in a workflow is shown as a plain sentence (for example "Immediately: send Welcome Email" or "Wait 3 days") instead of raw configuration, consistently on the editor, the automations list, and the template gallery preview. Click a Send Email step's **Edit details** to change its settings, or **Preview** to see the actual email that will go out.

New automations start as drafts. Review the linked emails and trigger in the editor. Choose **Activate** for a supported sequence, review the confirmation, and activate it when ready. Existing journeys can be paused. Promotional test sends remain unavailable; use email previews. Audience, overlap, timing and send-volume estimates are shown as unavailable when they cannot be verified.

## Promotions

Marketing → Promotions manages promo codes that customers can apply at checkout and that you can apply on manual bookings.

## Sending quota

Email sending draws from your plan's monthly included quota; the usage meter warns before you go into overage. Details of your plan are on the Billing page.

## Automatic chat booking offers

[Promotions](/marketing/promotions) includes **Automatic chat discounts**. Set the bookings required within a number of days, days since the last paid booking, and minimum/maximum group sizes. Add rules for different thresholds, choose a whole percentage from 0 to 100, or disable a rule. All configured conditions on a rule must match. Only paid and completed bookings count; the largest matching offer applies, without stacking automatic discounts. WhatsApp and web chat use the same saved rules and recheck them before checkout. Returning-guest offers are checked using the supplied phone number. Website checkout promo codes remain separate.

Choose **Add discount rule**, select **Bookings within a period**, **Time since last booking** or **Group size** under **Qualify by**, enter the thresholds and discount, enable the rule, then select **Save automatic discounts**. Saving an offer changes WhatsApp and web chat's eligibility rules for new quotes; it does not send an unsolicited promotional message.

## Welcome-back email sequences

In [Automations](/marketing/automations), use **Welcome-back email sequence** or select **Welcome back — time since last booking** in the builder. Set **Days since last paid booking**, then edit the email templates and delays. Save and preview the draft before activating. The starter sends an invitation followed by two optional follow-ups, without an automatically issued offer.

These sequences use verified paid booking history, including completed bookings with payment evidence. Unpaid completed bookings and refunded bookings do not qualify. Each cycle uses one last-booking date and rechecks permission, rebooking and upcoming reservations before sending. Legacy promotional WhatsApp win-back messages are also held. Transactional booking and payment emails continue separately.
