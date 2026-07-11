import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { periodBounds } from "@/app/lib/billing-period";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  // Billing management stays reachable regardless of subscription state.
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  let body: { delta?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { delta } = body;
  if (!Number.isInteger(delta) || delta === 0 || !delta || Math.abs(delta) > 50) {
    return NextResponse.json({ error: "delta must be a non-zero integer (max ±50)" }, { status: 400 });
  }

  const db = adminClient();

  // This used to select seats_purchased/billing_cycle_start/billing_cycle_end
  // — columns that only ever existed in a parked, never-applied migration.
  // PostgREST fails the WHOLE query when any selected column doesn't exist,
  // and the error was discarded (`const { data: sub } = await ...`), so `sub`
  // was always undefined and this endpoint 404'd on every call, for every
  // tenant, regardless of whether they had a real active subscription.
  const { data: sub, error: subErr } = await db.from("subscriptions")
    .select("id, plan_id, period_start, period_end, status")
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (subErr) console.error("BILLING_SEATS_SUB_LOOKUP_ERR business=" + caller.business_id + ": " + subErr.message);
  if (!sub) return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  // Matches requireActiveSubscription's own definition (app/lib/api-auth.ts)
  // — a TRIAL tenant can reach this route and must be able to add seats too.
  if (sub.status !== "ACTIVE" && sub.status !== "TRIAL") {
    return NextResponse.json({ error: "Subscription is not active" }, { status: 402 });
  }

  // The actual enforced/displayed seat count lives on businesses.max_admin_seats
  // everywhere else in the app (super-admin, /billing GET) — not on a
  // subscriptions.seats_purchased column that nothing else ever reads.
  const { data: bizRow, error: bizErr } = await db.from("businesses")
    .select("max_admin_seats").eq("id", caller.business_id).maybeSingle();
  if (bizErr) console.error("BILLING_SEATS_BIZ_LOOKUP_ERR business=" + caller.business_id + ": " + bizErr.message);
  const currentSeats = Number(bizRow?.max_admin_seats || 1);
  const newSeats = currentSeats + delta;
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

  const { data: plan, error: planErr } = await db.from("plans")
    .select("extra_seat_price_zar")
    .eq("id", String(sub.plan_id || "").toLowerCase())
    .maybeSingle();
  if (planErr) console.error("BILLING_SEATS_PLAN_LOOKUP_ERR business=" + caller.business_id + " plan=" + sub.plan_id + ": " + planErr.message);

  const seatPrice = Number(plan?.extra_seat_price_zar ?? 500);
  const { billing_cycle_start, billing_cycle_end } = periodBounds(sub.period_start, sub.period_end);
  const today = new Date();
  const cycleEnd = new Date(billing_cycle_end);
  const cycleStart = new Date(billing_cycle_start);
  const daysLeft = Math.max(0, Math.ceil((cycleEnd.getTime() - today.getTime()) / 86_400_000));
  const totalDays = Math.max(1, Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000));
  const proration = Math.round(seatPrice * (daysLeft / totalDays) * delta * 100) / 100;

  const { error: updateErr } = await db.from("businesses").update({ max_admin_seats: newSeats }).eq("id", caller.business_id);
  if (updateErr) {
    console.error("BILLING_SEATS_UPDATE_ERR business=" + caller.business_id + ": " + updateErr.message);
    return NextResponse.json({ error: "Failed to update seat count: " + updateErr.message }, { status: 500 });
  }

  if (proration !== 0) {
    // billing_line_items' real columns (source_type/source_id/kind/description/
    // amount_zar/status/period_key) don't match what used to be inserted here
    // (line_type/unit_amount_zar/total_amount_zar/billing_status/invoice_period_*
    // — none of which exist) — that insert failed silently every time too.
    const { error: lineErr } = await db.from("billing_line_items").insert({
      business_id: caller.business_id,
      source_type: "SUBSCRIPTION",
      source_id: sub.id,
      kind: "SEAT_PRORATION",
      description: (delta > 0 ? "Added " : "Removed ") + Math.abs(delta) + " seat(s) — prorated",
      amount_zar: proration,
      status: "PENDING",
      period_key: billing_cycle_start,
      metadata: { delta, seat_price_zar: seatPrice, new_seats: newSeats, days_left: daysLeft, total_days: totalDays },
    });
    if (lineErr) console.error("BILLING_SEATS_LINE_ITEM_ERR business=" + caller.business_id + ": " + lineErr.message);
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
