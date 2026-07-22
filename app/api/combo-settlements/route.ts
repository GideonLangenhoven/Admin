import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";
import { groupSettlements } from "../../lib/combo-settlements";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// GET /api/combo-settlements?business_id=xxx&period=2026-04-07..2026-04-13
// Returns a settlement summary: how much each operator collected and owes for combo bookings.
export async function GET(req: NextRequest) {
  if (!isComboEnabledServer()) return comboDisabledResponse();

  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }

  const businessId = req.nextUrl.searchParams.get("business_id");
  const period = req.nextUrl.searchParams.get("period"); // format: YYYY-MM-DD..YYYY-MM-DD

  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
    return NextResponse.json({ error: "You can only view settlements for your own business" }, { status: 403 });
  }

  const supabase = serviceClient();

  // Default period: last 7 days
  let endDate = new Date();
  let startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period) {
    const parts = period.split("..");
    if (parts.length === 2) {
      startDate = new Date(parts[0] + "T00:00:00+02:00");
      endDate = new Date(parts[1] + "T23:59:59+02:00");
    }
  }

  // Fetch all PAID combo bookings in the period where this business is involved
  const { data: combos, error } = await supabase
    .from("combo_bookings")
    .select("id, combo_total, split_a_amount, split_b_amount, payment_status, settled, created_at, combo_offers(name, business_a_id, business_b_id, business_a:businesses!combo_offers_business_a_id_fkey(business_name), business_b:businesses!combo_offers_business_b_id_fkey(business_name))")
    .in("payment_status", ["PAID", "VOUCHER_ISSUED"])
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter to combos involving this business
  const relevant = (combos || []).filter((c: any) => {
    const offer = c.combo_offers;
    return offer?.business_a_id === businessId || offer?.business_b_id === businessId;
  });

  // Calculate settlement per partnership
  const settlements: Record<string, any> = {};
  for (const combo of relevant as any[]) {
    const offer = combo.combo_offers;
    const isA = offer.business_a_id === businessId;
    const partnerId = isA ? offer.business_b_id : offer.business_a_id;
    const partnerName = isA ? offer.business_b?.business_name : offer.business_a?.business_name;

    if (!settlements[partnerId]) {
      settlements[partnerId] = {
        partner_id: partnerId,
        partner_name: partnerName || "Partner",
        total_combos: 0,
        total_collected_by_me: 0,  // amount collected via Yoco by this business
        total_owed_to_partner: 0,  // amount this business owes partner
        total_owed_to_me: 0,       // amount partner owes this business
        unsettled_count: 0,
        bookings: [],
      };
    }

    const s = settlements[partnerId];
    s.total_combos++;
    if (!combo.settled) s.unsettled_count++;

    // Business A (combo creator) collects the full payment via Yoco
    // They owe Business B the split_b_amount
    if (isA) {
      s.total_collected_by_me += Number(combo.combo_total);
      s.total_owed_to_partner += Number(combo.split_b_amount);
    } else {
      // I'm Business B — Operator A collected. They owe me my split.
      s.total_owed_to_me += Number(combo.split_b_amount);
    }

    s.bookings.push({
      id: combo.id,
      combo_name: offer.name,
      total: Number(combo.combo_total),
      my_share: isA ? Number(combo.split_a_amount) : Number(combo.split_b_amount),
      partner_share: isA ? Number(combo.split_b_amount) : Number(combo.split_a_amount),
      settled: combo.settled,
      date: combo.created_at,
    });
  }

  return NextResponse.json({
    period: { start: startDate.toISOString(), end: endDate.toISOString() },
    settlements: Object.values(settlements),
    total_combos: relevant.length,
  });
}

// POST /api/combo-settlements
// Mark combo bookings as settled
export async function POST(req: NextRequest) {
  if (!isComboEnabledServer()) return comboDisabledResponse();

  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { combo_booking_ids, notes } = body;
  if (!Array.isArray(combo_booking_ids) || combo_booking_ids.length === 0) {
    return NextResponse.json({ error: "combo_booking_ids array is required" }, { status: 400 });
  }

  const supabase = serviceClient();

  // Load the target combos and verify the caller's business is a party to
  // every one of them (SUPER_ADMIN excepted). Only unsettled PAID combos are
  // eligible — re-settling would double-count the settlement register.
  const { data: combos, error: loadErr } = await supabase
    .from("combo_bookings")
    .select("id, combo_total, split_b_amount, created_at, settled, payment_status, combo_offers(partnership_id, business_a_id, business_b_id)")
    .in("id", combo_booking_ids);
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });

  const eligible = (combos || []).filter((c: any) => {
    const offer = c.combo_offers;
    if (!offer) return false;
    if (caller.role !== "SUPER_ADMIN" && offer.business_a_id !== caller.business_id && offer.business_b_id !== caller.business_id) return false;
    return !c.settled && ["PAID", "VOUCHER_ISSUED"].includes(String(c.payment_status));
  });
  if (eligible.length === 0) {
    return NextResponse.json({ error: "No eligible combo bookings (must involve your business, be paid, and not already settled)." }, { status: 400 });
  }

  const settledAt = new Date().toISOString();
  const { error } = await supabase
    .from("combo_bookings")
    .update({
      settled: true,
      settled_at: settledAt,
      settlement_notes: notes || null,
    })
    .in("id", eligible.map((c: any) => c.id));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Write the settlement register (read by Reports → Settlement Register):
  // one row per partnership covering the batch just settled. Collector is
  // business A (they receive the full payment); they owe B the B-shares.
  for (const row of groupSettlements(eligible as any[])) {
    const { error: regErr } = await supabase.from("combo_settlements").insert({
      ...row,
      status: "SETTLED",
      settled_at: settledAt,
      settled_by: caller.id,
      notes: notes || null,
    });
    if (regErr) console.error("COMBO_SETTLEMENT_REGISTER_ERR:", regErr.message);
  }

  return NextResponse.json({ ok: true, settled: eligible.length });
}
