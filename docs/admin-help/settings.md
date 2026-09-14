---
title: Settings
route: /settings
required_role: MAIN_ADMIN
---

Settings is one page of collapsible sections covering your whole configuration. It's visible to MAIN_ADMIN and above — though a MAIN_ADMIN can grant a regular admin access to specific sections (per-section settings permissions), in which case that admin sees only their granted sections.

## Admin Users

Add dashboard users (they receive a password-setup email), resend setup links, remove admins, and grant per-section settings permissions. The Main Admin account can't be deleted. This section also lets you suspend or reactivate the subscription.

The **Billing contact** selector chooses who receives BookingTours subscription invoices. By default they go to the first admin created on the account; pick any other admin to redirect them.

## Tours & Activities

Create and edit your tours: name, description, duration, departure times, base and peak price. Drag to reorder how they appear on the booking site. A tour that has bookings can't be deleted.

## Booking Add-Ons

Optional extras customers can add at checkout (photo packages, equipment hire). Create, edit, and drag-reorder.

## Booking Site Configuration

Everything about your customer-facing booking site: policies (terms, privacy, directions), branding and hero text, button and footer copy, theme colours, chatbot avatar, cancellation policy tiers, and **custom booking questions** asked at checkout (templates available). Includes a live copy preview.

## Embed Widget

A copyable snippet to embed your booking widget on your own website.

## Email Customisation

Per-email-type colour themes and banner images for the emails customers receive (confirmations, invoices, cancellations, photos, and so on).

## Operations & AI Configuration

Meeting point details, what to bring and wear, FAQ answers, and the AI chatbot's personality. This content feeds the customer-facing chat assistant — the better you fill it in, the better the bot answers.

## WhatsApp Bot Mode

Controls when the AI auto-replies on WhatsApp: always, only outside business hours, or never.

## Automation Tag Rules

Rules that automatically tag marketing contacts based on booking behaviour (for example tag customers who booked a specific tour), for targeting campaigns.

## Invoice & Banking Details

The company information and banking details printed on customer pro forma invoices.

## Integration Credentials

WhatsApp (access token and phone number ID), Yoco payments (live keys plus a test mode toggle), and Google Drive connection for trip photos. Credentials are encrypted at rest and can only ever be edited by MAIN_ADMIN and above — this section is never delegatable to sub-admins.

## Chat FAQ (Quick Answers)

Quick Answers for the customer chatbot are NOT managed inside Settings. They live on their own Chat FAQ page in the sidebar, under the Admin group. See the Chat FAQ article.
