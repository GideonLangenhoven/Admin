import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { periodBounds } from "@/app/lib/billing-period";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

// Change a tenant's subscription plan tier (Starter/Growth/Pro). Privileged
// only. Mirrors /api/billing/seats: the mid-cycle base-price difference is
// prorated into a PENDING billing_line_items entry (positive = charge on
// upgrade, negative = credit on downgrade), and everything is audit-logged.
export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  let body: { plan_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const newPlanId = String(body.plan_id || "").toLowerCase();
  if (!newPlanId) return NextResponse.json({ error: "plan_id is required" }, { status: 400 });

  const db = adminClient();

  const { data: newPlan, error: planErr } = await db.from("plans")
    .select("id, name, monthly_price_zar, seat_limit, active")
    .eq("id", newPlanId)
    .maybeSingle();
  if (planErr) console.error("BILLING_PLAN_LOOKUP_ERR business=" + caller.business_id + " plan=" + newPlanId + ": " + planErr.message);
  if (!newPlan || newPlan.active === false) {
    return NextResponse.json({ error: "Unknown or inactive plan" }, { status: 400 });
  }

  const { data: sub, error: subErr } = await db.from("subscriptions")
    .select("id, plan_id, period_start, period_end, status")
    .eq("business_id", caller.business_id)
    .maybeSingle();
  if (subErr) console.error("BILLING_PLAN_SUB_LOOKUP_ERR business=" + caller.business_id + ": " + subErr.message);
  if (!sub) return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  if (sub.status !== "ACTIVE" && sub.status !== "TRIAL") {
    return NextResponse.json({ error: "Subscription is not active" }, { status: 402 });
  }
  if (String(sub.plan_id || "").toLowerCase() === newPlanId) {
    return NextResponse.json({ ok: true, plan_id: newPlanId }); // no-op
  }

  const { data: oldPlan } = await db.from("plans")
    .select("monthly_price_zar")
    .eq("id", String(sub.plan_id || "").toLowerCase())
    .maybeSingle();
  const oldBase = Number(oldPlan?.monthly_price_zar || 0);
  const newBase = Number(newPlan.monthly_price_zar || 0);

  // Prorate the base-price difference over the days left in the cycle.
  const { billing_cycle_start, billing_cycle_end } = periodBounds(sub.period_start, sub.period_end);
  const cycleStart = new Date(billing_cycle_start);
  const cycleEnd = new Date(billing_cycle_end);
  const today = new Date();
  const daysLeft = Math.max(0, Math.ceil((cycleEnd.getTime() - today.getTime()) / 86_400_000));
  const totalDays = Math.max(1, Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000));
  const proration = Math.round((newBase - oldBase) * (daysLeft / totalDays) * 100) / 100;

  const { error: updErr } = await db.from("subscriptions").update({ plan_id: newPlanId }).eq("id", sub.id);
  if (updErr) {
    console.error("BILLING_PLAN_UPDATE_ERR business=" + caller.business_id + ": " + updErr.message);
    return NextResponse.json({ error: "Failed to change plan: " + updErr.message }, { status: 500 });
  }

  // Ensure the tenant keeps at least the seats their new plan includes — never
  // strand existing admins, and grant an upgrade's included seats up front.
  const { data: bizRow } = await db.from("businesses").select("max_admin_seats").eq("id", caller.business_id).maybeSingle();
  const includedSeats = Number(newPlan.seat_limit || 1);
  const targetSeats = Math.max(Number(bizRow?.max_admin_seats || 1), includedSeats);
  if (targetSeats !== Number(bizRow?.max_admin_seats || 1)) {
    await db.from("businesses").update({ max_admin_seats: targetSeats }).eq("id", caller.business_id);
  }

  if (proration !== 0) {
    const { error: lineErr } = await db.from("billing_line_items").insert({
      business_id: caller.business_id,
      source_type: "SUBSCRIPTION",
      source_id: sub.id,
      kind: "PLAN_CHANGE",
      description: "Plan change to " + newPlan.name + ", prorated",
      amount_zar: proration,
      status: "PENDING",
      period_key: billing_cycle_start,
      metadata: { from_plan: sub.plan_id, to_plan: newPlanId, old_base_zar: oldBase, new_base_zar: newBase, days_left: daysLeft, total_days: totalDays },
    });
    if (lineErr) console.error("BILLING_PLAN_LINE_ITEM_ERR business=" + caller.business_id + ": " + lineErr.message);
  }

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "BILLING_PLAN_CHANGED",
    target_entity: "subscriptions",
    target_id: sub.id,
    after_state: { from_plan: sub.plan_id, to_plan: newPlanId, proration },
  });

  return NextResponse.json({ ok: true, plan_id: newPlanId, proration_zar: proration });
}
