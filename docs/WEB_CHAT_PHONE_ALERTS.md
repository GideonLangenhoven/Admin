# Web chat phone alerts

Operators opt in per phone from **Inbox → Phone alerts for web chat**. A push
is sent when the website chat hands a conversation to a human and when that
visitor writes again while the conversation remains in `HUMAN` status. Bot
answered chats do not alert. The notification contains no guest message text;
tapping it opens the conversation in the operator Inbox.

## Activation

1. Apply `20260928102000_admin_web_push_subscriptions.sql` to the linked
   Supabase project. The subscription table is service-role only.
2. Generate one VAPID key pair and keep it stable. Set `WEB_PUSH_PUBLIC_KEY`,
   `WEB_PUSH_PRIVATE_KEY`, and a random `ADMIN_PUSH_SECRET` in the Admin Vercel
   environment. Redeploy Admin after setting them.
3. Set `ADMIN_PUSH_URL` to
   `https://admin.bookingtours.co.za/api/internal/web-chat-push` and the same
   `ADMIN_PUSH_SECRET` in Supabase Edge secrets. Deploy the `web-chat` function.
4. On each operator phone, open its own Admin site, sign in, visit Inbox, and
   tap **Enable alerts**. On iPhone/iPad, add the site to the Home Screen and
   open that installed web app before opting in. Allow notifications in the
   phone's system prompt.
5. Use a test website chat to request a human, then send a follow-up message.
   Confirm one notification opens the correct Inbox thread. Confirm a bot
   answered question creates no phone alert. Turn alerts off from Inbox to
   verify unsubscribe.

The browser push provider controls delivery timing. Phone notifications also
depend on the user's permission, network, and device notification settings.
The Inbox remains the source of truth when a push is delayed or unavailable.
