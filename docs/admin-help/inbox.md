---
title: Inbox
route: /inbox
required_role: OPERATOR
---

The Inbox is the unified conversation console for WhatsApp and website chat. The AI assistant answers routine questions automatically; conversations that need a human float to the top with a "Needs reply" pill.

## How bot and human handoff works

The assistant handles routine conversations until the customer asks for a person or a handoff is needed. Sending an admin reply moves the conversation to human handling. Use **Return to Bot** when the human exchange is complete; bot replies still follow the saved mode, business hours and reply allowance. Check the returned result if handoff cannot complete.

**Bot replying** means the automated assistant is handling that conversation. **Needs reply** means a staff member should respond.

When a website visitor explicitly asks for a person, accepts an offered handoff, or taps **Talk to a human**, a WhatsApp alert is sent to the business WhatsApp contact saved in Settings. The alert opens that conversation in Inbox. Routine bot messages and later messages in the same human conversation do not send another WhatsApp alert. Browser notifications continue separately. A failed WhatsApp alert does not prevent the request appearing in Inbox.

On mobile, the conversation fills the available space. The search is at the top of the conversation list; counts and Refresh remain on desktop. The list updates automatically.

For website conversations, **End Chat** ends the active human chat and asks the visitor to rate it. Ending a chat does not cancel a booking or process a refund.

## Replying

Select a conversation to see the full thread — bot, customer, and admin messages are visually distinct, grouped by day, and update in real time. Type your reply and send; it goes out on the same channel the customer used (WhatsApp or web chat).

## The WhatsApp 24-hour window

WhatsApp only allows businesses to send free-form messages within 24 hours of the customer's last message. This is a WhatsApp platform rule, not a BookingTours limitation.

If the window has closed, your message isn't lost: the system automatically sends the customer a pre-approved "please reply" template, and your message is queued (marked with ⏳ in the thread). The moment they reply, the queued message is delivered and the window reopens — from then on you can chat live in the Inbox as normal.

## Finding a conversation

Search by name, phone number, or email. Conversations needing attention sort first, then by recency. Opening the Inbox from a booking's WhatsApp action jumps straight to that customer.

## WhatsApp not configured?

If replies fail with a credentials message, your WhatsApp integration isn't set up. A MAIN_ADMIN can add the WhatsApp token and phone number ID under Settings → Integration Credentials.

WhatsApp handoff alerts use the business's WhatsApp credentials. Outside an active messaging window, Meta must approve the `web_chat_handoff` template in that business's WhatsApp account before alerts can be delivered. The template language defaults to `en`; `WA_WEB_CHAT_HANDOFF_TEMPLATE_NAME` and `WA_WEB_CHAT_HANDOFF_TEMPLATE_LANGUAGE` can select an approved equivalent. Its body must have two parameters, in this order: business name and the Inbox conversation URL.

Template body: `A website visitor has asked to speak to a person at {{1}}. Open the conversation in BookingTours: {{2}}`
