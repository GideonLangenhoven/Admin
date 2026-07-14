import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { computeActiveDays, monthBounds, type PauseEvent } from "@/app/lib/platform-billing";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

function buildPauseNote(pauseWindows: Array<{ start: string; end: string }>): string | null {
  if (pauseWindows.length === 0) return null;
  return "Paused " + pauseWindows.map((w) => `${w.start} to ${w.end}`).join(", ");
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  const period = req.nextUrl.searchParams.get("period") || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const { periodStart, periodEnd } = monthBounds(period);
  const asOfDate = new Date().toISOString().slice(0, 10);

  const db = adminClient();

  const [bizRes, subRes, planRes, auditRes, invoiceRes] = await Promise.all([
    db.from("businesses").select("id, business_name").order("business_name"),
    db.from("subscriptions").select("business_id, plan_id, status, period_start, period_end"),
    db.from("plans").select("id, name, monthly_price_zar"),
    db.from("audit_logs").select("business_id, action_type, created_at")
      .in("action_type", ["BILLING_PAUSED", "BILLING_RESUMED"])
      .order("created_at", { ascending: true }),
    db.from("platform_invoices").select("*").eq("period_start", periodStart),
  ]);

  if (bizRes.error) return NextResponse.json({ error: bizRes.error.message }, { status: 500 });

  const subByBusiness = new Map((subRes.data || []).map((s: any) => [s.business_id, s]));
  const planById = new Map((planRes.data || []).map((p: any) => [p.id, p]));
  const invoiceByBusiness = new Map((invoiceRes.data || []).map((inv: any) => [inv.business_id, inv]));
  const pauseEventsByBusiness = new Map<string, PauseEvent[]>();
  for (const ev of auditRes.data || []) {
    const list = pauseEventsByBusiness.get(ev.business_id) || [];
    list.push({ action_type: ev.action_type, created_at: ev.created_at });
    pauseEventsByBusiness.set(ev.business_id, list);
  }

  const rows = (bizRes.data || []).map((biz: any) => {
    const sub = subByBusiness.get(biz.id);
    const existingInvoice = invoiceByBusiness.get(biz.id) || null;
    if (!sub) {
      return { business_id: biz.id, business_name: biz.business_name, has_subscription: false, existing_invoice: existingInvoice };
    }
    const plan = planById.get(sub.plan_id);
    const planName = plan?.name || sub.plan_id;
    const monthlyPriceZar = Number(plan?.monthly_price_zar || 0);
    const pauseEvents = pauseEventsByBusiness.get(biz.id) || [];

    const { activeDays, totalDays, pauseWindows } = computeActiveDays(
      periodStart, periodEnd, sub.period_start, sub.period_end, pauseEvents, sub.status, asOfDate,
    );
    const proRated = activeDays !== totalDays;
    const amountZar = Math.round(monthlyPriceZar * (activeDays / totalDays) * 100) / 100;

    return {
      business_id: biz.id,
      business_name: biz.business_name,
      has_subscription: true,
      plan_id: sub.plan_id,
      plan_name: planName,
      monthly_price_zar: monthlyPriceZar,
      active_days: activeDays,
      total_days: totalDays,
      pro_rated: proRated,
      pause_note: buildPauseNote(pauseWindows),
      amount_zar: amountZar,
      existing_invoice: existingInvoice,
    };
  });

  return NextResponse.json({ period, period_start: periodStart, period_end: periodEnd, rows });
}
