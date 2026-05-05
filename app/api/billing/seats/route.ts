import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  let body: { delta?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { delta } = body;
  if (!Number.isInteger(delta) || delta === 0 || !delta || Math.abs(delta) > 50) {
    return NextResponse.json({ error: "delta must be a non-zero integer (max ±50)" }, { status: 400 });
  }

  const db = adminClient();

  const { data: sub } = await db.from("subscriptions")
    .select("id, seats_purchased, plan_id, billing_cycle_start, billing_cycle_end, status")
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!sub) return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  if (sub.status !== "ACTIVE") return NextResponse.json({ error: "Subscription is not active" }, { status: 402 });

  const newSeats = (sub.seats_purchased ?? 1) + delta;
  if (newSeats < 1) return NextResponse.json({ error: "Minimum 1 seat required" }, { status: 400 });

  if (delta < 0) {
    const { count: active } = await db.from("admin_users")
      .select("*", { count: "exact", head: true })
      .eq("business_id", caller.business_id)
      .eq("suspended", false);
    if ((active ?? 0) > newSeats) {
      return NextResponse.json({
        error: `You currently have ${active} active admins. Remove or suspend admins before lowering seats.`,
      }, { status: 400 });
    }
  }

  const { data: plan } = await db.from("plans")
    .select("extra_seat_price_zar, included_seats")
    .eq("id", sub.plan_id)
    .maybeSingle();

  const seatPrice = Number(plan?.extra_seat_price_zar ?? 750);
  const today = new Date();
  const cycleEnd = new Date(sub.billing_cycle_end);
  const cycleStart = new Date(sub.billing_cycle_start);
  const daysLeft = Math.max(0, Math.ceil((cycleEnd.getTime() - today.getTime()) / 86_400_000));
  const totalDays = Math.max(1, Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000));
  const proration = Math.round(seatPrice * (daysLeft / totalDays) * delta * 100) / 100;

  await db.from("subscriptions").update({ seats_purchased: newSeats }).eq("id", sub.id);

  if (proration !== 0) {
    await db.from("billing_line_items").insert({
      business_id: caller.business_id,
      invoice_period_start: sub.billing_cycle_start,
      invoice_period_end: sub.billing_cycle_end,
      line_type: "PRORATION",
      quantity: delta,
      unit_amount_zar: seatPrice,
      total_amount_zar: proration,
      billing_status: "PENDING",
    });
  }

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: delta > 0 ? "BILLING_SEATS_ADDED" : "BILLING_SEATS_REMOVED",
    target_entity: "subscriptions",
    target_id: sub.id,
    after_state: { delta, new_seats: newSeats, proration },
  });

  return NextResponse.json({ ok: true, new_seats: newSeats, proration_zar: proration });
}
