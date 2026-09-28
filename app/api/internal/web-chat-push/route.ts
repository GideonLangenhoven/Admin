import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_PUSH_SECRET || "";
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const tokenBytes = Buffer.from(token);
  const secretBytes = Buffer.from(secret);
  if (!secret || tokenBytes.length !== secretBytes.length || !timingSafeEqual(tokenBytes, secretBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return NextResponse.json({ error: "Phone alerts are not configured" }, { status: 503 });
  const { business_id: businessId, phone } = await req.json().catch(() => ({}));
  if (typeof businessId !== "string" || !UUID.test(businessId) || typeof phone !== "string" || !/^web:[0-9a-f-]{36}$/i.test(phone)) {
    return NextResponse.json({ error: "Invalid chat" }, { status: 400 });
  }

  // The sender may only notify a live human-handled web conversation in this
  // tenant, even if an internal caller passes a different business or chat.
  const { data: conversation, error: conversationError } = await db.from("conversations")
    .select("id").eq("business_id", businessId).eq("phone", phone).eq("status", "HUMAN").maybeSingle();
  if (conversationError) return NextResponse.json({ error: "Chat lookup failed" }, { status: 500 });
  if (!conversation) return NextResponse.json({ sent: 0 });

  const { data: subscriptions, error } = await db.from("admin_web_push_subscriptions")
    .select("id, admin_user_id, endpoint, p256dh, auth").eq("business_id", businessId);
  if (error) return NextResponse.json({ error: "Phone alert lookup failed" }, { status: 500 });
  if (!subscriptions?.length) return NextResponse.json({ sent: 0 });
  const { data: admins, error: adminError } = await db.from("admin_users")
    .select("id, business_id, role, suspended, read_only")
    .in("id", subscriptions.map((s) => s.admin_user_id));
  if (adminError) return NextResponse.json({ error: "Operator lookup failed" }, { status: 500 });
  const activeAdmins = new Set((admins || [])
    .filter((a) => !a.suspended && !a.read_only && (a.business_id === businessId || a.role === "SUPER_ADMIN"))
    .map((a) => a.id));

  webpush.setVapidDetails("mailto:support@bookingtours.co.za", publicKey, privateKey);
  const payload = JSON.stringify({
    title: "Guest message needs a reply",
    body: "Open your BookingTours Inbox to respond.",
    url: "/inbox?phone=" + encodeURIComponent(phone),
    tag: "web-chat-" + conversation.id,
  });
  let sent = 0;
  await Promise.all(subscriptions.filter((s) => activeAdmins.has(s.admin_user_id)).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("admin_web_push_subscriptions").delete().eq("id", s.id).eq("business_id", businessId);
      } else {
        console.error("WEB_CHAT_PUSH_FAILED", { businessId, status });
      }
    }
  }));
  return NextResponse.json({ sent });
}
