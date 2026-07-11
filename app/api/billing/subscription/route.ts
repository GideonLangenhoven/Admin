import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { periodBounds } from "@/app/lib/billing-period";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

// AB1: the prior version of this route queried subscriptions.seats_purchased,
// billing_cycle_start, paused_at, payment_method_last4, and a plans(...) join
// — none of which exist in the real schema. PostgREST silently returned an
// error and the page rendered the empty-state copy. The data tenants actually
// need (plan, seats, billing period, email usage, overage rate) lives on
// `businesses` + the simpler `subscriptions` row, plus the real `plans` table
// for pricing — a hardcoded PLAN_PRICING map used to live here too, which was
// its own drift risk (it didn't even match plans.monthly_price_zar). Both
// this route and /api/billing/seats now read pricing from the same place.
const FALLBACK_PLAN = { name: "Pro", monthly_price_zar: 1500, extra_seat_price_zar: 500, included_seats: 1 };

export async function GET(req: NextRequest) {
  // A suspended tenant must still see their billing status to reactivate.
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();

  // Scope usage to the CURRENT calendar-month period, matching the
  // super-admin "Email Usage & Billing" panel (app/super-admin/page.tsx).
  // This route previously read businesses.marketing_email_usage — a
  // lifetime, never-reset counter — so once a tenant crossed their included
  // quota even once, every future month showed a permanent overage charge,
  // even months with zero sends.
  const currentPeriod = new Date().toISOString().slice(0, 7); // "2026-03"

  const [bizRes, subRes, usageRes] = await Promise.all([
    db.from("businesses")
      .select("id, business_name, name, max_admin_seats, subscription_status, marketing_included_emails, marketing_overage_rate_zar")
      .eq("id", caller.business_id)
      .maybeSingle(),
    db.from("subscriptions")
      .select("id, status, plan_id, period_start, period_end")
      .eq("business_id", caller.business_id)
      .maybeSingle(),
    db.from("marketing_usage_monthly")
      .select("emails_sent")
      .eq("business_id", caller.business_id)
      .eq("period", currentPeriod)
      .maybeSingle(),
  ]);

  if (!bizRes.data) {
    return NextResponse.json({ subscription: null, used_seats: 0, monthly_total_zar: 0 });
  }
  const biz = bizRes.data as any;
  const sub = subRes.data as any | null;

  const planId = String(sub?.plan_id || "pro").toLowerCase();
  const planRes = await db.from("plans")
    .select("name, monthly_price_zar, extra_seat_price_zar, seat_limit")
    .eq("id", planId)
    .maybeSingle();
  if (planRes.error) console.error("BILLING_PLAN_LOOKUP_ERR business=" + caller.business_id + " plan=" + planId + ": " + planRes.error.message);
  const planRow = planRes.data as any | null;
  const plan = planRow
    ? { name: planRow.name, monthly_price_zar: Number(planRow.monthly_price_zar), extra_seat_price_zar: Number(planRow.extra_seat_price_zar), included_seats: Number(planRow.seat_limit) }
    : FALLBACK_PLAN;

  const seatsPurchased = Number(biz.max_admin_seats || plan.included_seats || 1);
  const { billing_cycle_start, billing_cycle_end } = periodBounds(sub?.period_start || null, sub?.period_end || null);

  const subscription = {
    id: sub?.id || biz.id,
    status: String(sub?.status || biz.subscription_status || "ACTIVE").toUpperCase(),
    seats_purchased: seatsPurchased,
    billing_cycle_start,
    billing_cycle_end,
    paused_at: null,
    resumed_at: null,
    payment_method_last4: null,
    payment_provider: null,
    plans: plan,
  };

  // Active admins for "used_seats"
  const { count: usedSeats } = await db.from("admin_users")
    .select("*", { count: "exact", head: true })
    .eq("business_id", caller.business_id)
    .eq("suspended", false);

  // Monthly total = plan base + extra-seat overage. Overage formula matches
  // the super-admin "Email Usage & Billing" panel so the two views agree.
  const extraSeats = Math.max(0, seatsPurchased - plan.included_seats);
  const seatTotal = plan.monthly_price_zar + extraSeats * plan.extra_seat_price_zar;
  const emailUsage = Number(usageRes.data?.emails_sent || 0);
  const emailIncluded = Number(biz.marketing_included_emails || 0);
  const emailRate = Number(biz.marketing_overage_rate_zar || 0);
  const overageEmails = Math.max(0, emailUsage - emailIncluded);
  const emailOverage = Math.round(overageEmails * emailRate * 100) / 100;
  const monthlyTotal = seatTotal + emailOverage;

  return NextResponse.json({
    subscription,
    used_seats: usedSeats ?? 0,
    monthly_total_zar: monthlyTotal,
    email_usage: {
      sent: emailUsage,
      included: emailIncluded,
      overage_emails: overageEmails,
      overage_rate_zar: emailRate,
      overage_charge_zar: emailOverage,
    },
  });
}
