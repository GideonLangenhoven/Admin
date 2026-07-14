import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { computeActiveDays, monthBounds } from "@/app/lib/platform-billing";
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

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  let body: { business_id?: string; period?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const businessId = String(body.business_id || "");
  const period = String(body.period || "");
  if (!businessId || !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "business_id and period (YYYY-MM) are required" }, { status: 400 });
  }

  const { periodStart, periodEnd } = monthBounds(period);
  const asOfDate = new Date().toISOString().slice(0, 10);
  const db = adminClient();

  // Re-derive everything server-side — never trust a client-computed amount.
  const { data: sub, error: subErr } = await db.from("subscriptions")
    .select("plan_id, status, period_start, period_end")
    .eq("business_id", businessId)
    .maybeSingle();
  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
  if (!sub) return NextResponse.json({ error: "No subscription found for this business" }, { status: 404 });

  const { data: plan } = await db.from("plans").select("name, monthly_price_zar").eq("id", sub.plan_id).maybeSingle();
  const planName = plan?.name || sub.plan_id;
  const monthlyPriceZar = Number(plan?.monthly_price_zar || 0);

  const { data: pauseRows } = await db.from("audit_logs")
    .select("action_type, created_at")
    .eq("business_id", businessId)
    .in("action_type", ["BILLING_PAUSED", "BILLING_RESUMED"])
    .order("created_at", { ascending: true });

  const { activeDays, totalDays, pauseWindows } = computeActiveDays(
    periodStart, periodEnd, sub.period_start, sub.period_end,
    (pauseRows || []) as any, sub.status, asOfDate,
  );
  const proRated = activeDays !== totalDays;
  const amountZar = Math.round(monthlyPriceZar * (activeDays / totalDays) * 100) / 100;

  const { data: invoice, error: insertErr } = await db.from("platform_invoices").insert({
    business_id: businessId,
    period_start: periodStart,
    period_end: periodEnd,
    plan_id: sub.plan_id,
    plan_name: planName,
    monthly_price_zar: monthlyPriceZar,
    active_days: activeDays,
    total_days: totalDays,
    pro_rated: proRated,
    pause_note: buildPauseNote(pauseWindows),
    amount_zar: amountZar,
    status: "DRAFT",
  }).select("*").single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ error: "An invoice for this business and period already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: businessId,
    action_type: "PLATFORM_INVOICE_GENERATED",
    target_entity: "platform_invoices",
    target_id: invoice.id,
    after_state: { amount_zar: amountZar, active_days: activeDays, total_days: totalDays, pro_rated: proRated },
  });

  return NextResponse.json({ ok: true, invoice });
}
