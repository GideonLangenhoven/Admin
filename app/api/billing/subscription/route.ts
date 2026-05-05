import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();

  const { data: sub } = await db.from("subscriptions")
    .select(`
      id, status, seats_purchased, billing_cycle_start, billing_cycle_end,
      paused_at, resumed_at, payment_method_last4, payment_provider,
      plans(name, monthly_price_zar, extra_seat_price_zar, included_seats, features_json)
    `)
    .eq("business_id", caller.business_id)
    .maybeSingle();

  const { count: usedSeats } = await db.from("admin_users")
    .select("*", { count: "exact", head: true })
    .eq("business_id", caller.business_id)
    .eq("suspended", false);

  const { data: monthly } = await db.rpc("subscription_monthly_total", { p_business_id: caller.business_id });

  return NextResponse.json({
    subscription: sub,
    used_seats: usedSeats ?? 0,
    monthly_total_zar: Number(monthly ?? 0),
  });
}
