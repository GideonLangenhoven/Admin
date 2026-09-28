import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin } from "@/app/lib/api-auth";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(url.hostname);
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ publicKey: process.env.WEB_PUSH_PUBLIC_KEY || "" });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const subscription = await req.json().catch(() => null);
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!validEndpoint(endpoint) || typeof p256dh !== "string" || p256dh.length > 256 || !/^[A-Za-z0-9_-]+$/.test(p256dh)
    || typeof auth !== "string" || auth.length > 256 || !/^[A-Za-z0-9_-]+$/.test(auth)) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }
  const { error } = await db.from("admin_web_push_subscriptions").upsert({
    business_id: caller.business_id,
    admin_user_id: caller.id,
    endpoint, p256dh, auth,
  }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: "Could not save phone alerts" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({}));
  if (!validEndpoint(endpoint)) return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  const { error } = await db.from("admin_web_push_subscriptions").delete()
    .eq("admin_user_id", caller.id).eq("endpoint", endpoint);
  if (error) return NextResponse.json({ error: "Could not turn off phone alerts" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
