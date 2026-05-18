import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
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
// `businesses` + the simpler `subscriptions` row. Read from those.
const PLAN_PRICING: Record<string, { name: string; monthly_price_zar: number; extra_seat_price_zar: number; included_seats: number }> = {
  pro: { name: "Pro", monthly_price_zar: 1500, extra_seat_price_zar: 750, included_seats: 1 },
  starter: { name: "Starter", monthly_price_zar: 750, extra_seat_price_zar: 750, included_seats: 1 },
  growth: { name: "Growth", monthly_price_zar: 2500, extra_seat_price_zar: 750, included_seats: 3 },
};

function periodBounds(rawStart: string | null, rawEnd: string | null) {
  const now = new Date();
  const fallbackStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fallbackEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const start = rawStart ? new Date(rawStart) : fallbackStart;
  // period_end is often null while a subscription is open-ended; bound it to
  // the calendar month end so the UI has a real date to render.
  const end = rawEnd && !Number.isNaN(new Date(rawEnd).getTime())
    ? new Date(rawEnd)
    : new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    billing_cycle_start: start.toISOString().slice(0, 10),
    billing_cycle_end: end.toISOString().slice(0, 10),
  };
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();

  const [bizRes, subRes] = await Promise.all([
    db.from("businesses")
      .select("id, business_name, name, max_admin_seats, subscription_status, marketing_email_usage, marketing_included_emails, marketing_overage_rate_zar")
      .eq("id", caller.business_id)
      .maybeSingle(),
    db.from("subscriptions")
      .select("id, status, plan_id, period_start, period_end")
      .eq("business_id", caller.business_id)
      .maybeSingle(),
  ]);

  if (!bizRes.data) {
    return NextResponse.json({ subscription: null, used_seats: 0, monthly_total_zar: 0 });
  }
  const biz = bizRes.data as any;
  const sub = subRes.data as any | null;

  const planId = String(sub?.plan_id || "pro").toLowerCase();
  const plan = PLAN_PRICING[planId] || { name: planId.charAt(0).toUpperCase() + planId.slice(1), monthly_price_zar: 1500, extra_seat_price_zar: 750, included_seats: 1 };

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
  const emailUsage = Number(biz.marketing_email_usage || 0);
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
