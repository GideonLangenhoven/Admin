---
title: Marketing
route: /marketing
required_role: OPERATOR
---

Marketing is your email-marketing hub: contacts, templates, campaigns, automations, and promotions, with an analytics overview.

## Setting up email sending

If Marketing says **Marketing emails are not enabled yet**, select **Request email setup**. This opens an email to BookingTours support requesting help finishing setup and checking customer permission records. Review and send the email yourself. There is no operator switch that enables sending while setup is incomplete. You can still save and preview drafts.

Select **Review contacts** to open the contact list. A contact who needs permission checked does not yet have a confirmed record of agreeing to marketing emails. Adding or importing their email address is not enough. Ask BookingTours to review the original signup or permission record; do not change an unsubscribed contact back to active to bypass this check.

## The overview page

The landing page shows Active Contacts, Templates, Emails Sent, and Campaigns, an **Email Usage This Month** meter (emails sent versus your plan's included quota, with overage cost projection), and charts for engagement (open, click, unsubscribe, bounce rates), campaign performance, audience breakdown, and open-rate trend.

Choose **Ask for reviews**, **Welcome new enquiries** or **Invite customers back**, then **Choose email** to view a starting template. The count shows contacts matching that option, not emails already sent. The initial Invite customers back count uses 90 days since the last paid booking; adjust timing in the saved draft. Automatic **Voucher expiry reminders** are not available yet. **View vouchers** opens the voucher list to check a voucher yourself.

## Contacts

Use the **Contacts** tab to manage your audience. **Templates**, **Automations**, **Promos** and **Vouchers** are the other tabs in Marketing. Automatic tag rules in Settings can segment contacts based on booking behaviour. Campaign sending requires eligible active contacts with marketing consent; unsubscribed contacts are excluded.

## Templates and campaigns

Design reusable email templates under Marketing → Templates and preview them before preparing a campaign. Promotional test sends and campaign delivery remain unavailable until the delivery controls and permission evidence are ready. A scheduled campaign can be **cancelled** and a sending campaign **paused** from Recent Campaigns on the overview. These controls stop remaining sends; emails already delivered cannot be recalled.

## Automations

Under Marketing → Automations you can draft triggered emails, for example a message a number of days before or after a booking date, birthday offers, or win-back campaigns. Browse Templates for ready-made flows (welcome series, post-tour review requests, win-back campaigns and more) that come with designed emails already linked, or start from scratch. Draft steps can include one-off vouchers or promo codes, but automatic issuance and promotional delivery remain held.

Every step in a workflow is shown as a plain sentence (for example "Immediately: send Welcome Email" or "Wait 3 days") instead of raw configuration, consistently on the editor, the automations list, and the template gallery preview. Click a Send Email step's **Edit details** to change its settings, or **Preview** to see the actual email that will go out.

New automations start as drafts. Review the linked emails and trigger in the editor. Activation and promotional test sends are currently unavailable; existing journeys can be paused. Audience, overlap, timing and send-volume estimates are shown as unavailable when they cannot be verified.

## Promotions

Marketing → Promotions manages promo codes that customers can apply at checkout and that you can apply on manual bookings.

## Sending quota

Email sending draws from your plan's monthly included quota; the usage meter warns before you go into overage. Details of your plan are on the Billing page.

## Automatic WhatsApp booking offers

[Promotions](/marketing/promotions) includes **Automatic WhatsApp discounts**. Set the bookings required within a number of days, days since the last paid booking, and minimum/maximum group sizes. Add rules for different thresholds, choose a whole percentage from 0 to 100, or disable a rule. All configured conditions on a rule must match. Only paid and completed bookings count; the largest matching offer applies, without stacking automatic discounts. The bot rechecks the saved rules before checkout. These settings apply to WhatsApp booking quotes; website promo codes remain separate.

Choose **Add discount rule**, select **Bookings within a period**, **Time since last booking** or **Group size** under **Qualify by**, enter the thresholds and discount, enable the rule, then select **Save automatic discounts**. Saving an offer changes the WhatsApp bot's eligibility rules for new quotes; it does not send an unsolicited promotional message.

## Welcome-back email sequences

In [Automations](/marketing/automations), use **Welcome-back email sequence** or select **Welcome back — time since last booking** in the builder. Set **Days since last paid booking**, then edit the email templates, delays and optional promo-code steps. The starter draft describes a percentage promo code rather than a cash voucher. Save and preview the draft. Automatic welcome-back delivery and promo issuance remain held while the event and delivery controls are completed; the draft cannot be activated yet.

These sequences use the last paid/completed booking date, not signup date. The configured sequence is based on one last-booking date per cycle and checks for rebooking, unsubscribe and upcoming reservations. It does not send while held. Legacy promotional WhatsApp win-back messages are also held. Transactional booking and payment emails continue separately.
