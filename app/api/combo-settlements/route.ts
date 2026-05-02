import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";

function serviceClient() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// GET /api/combo-settlements?business_id=xxx&period=2026-04-07..2026-04-13
// Returns a settlement summary: how much each operator collected and owes for combo bookings.
export async function GET(req: NextRequest) {
  if (!isComboEnabledServer()) return comboDisabledResponse();
  var businessId = req.nextUrl.searchParams.get("business_id");
  var period = req.nextUrl.searchParams.get("period"); // format: YYYY-MM-DD..YYYY-MM-DD

  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

  var supabase = serviceClient();

  // Default period: last 7 days
  var endDate = new Date();
  var startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period) {
    var parts = period.split("..");
    if (parts.length === 2) {
      startDate = new Date(parts[0] + "T00:00:00+02:00");
      endDate = new Date(parts[1] + "T23:59:59+02:00");
    }
  }

  // Fetch all PAID combo bookings in the period where this business is involved
  var { data: combos, error } = await supabase
    .from("combo_bookings")
    .select("id, combo_total, split_a_amount, split_b_amount, payment_status, settled, created_at, combo_offers(name, business_a_id, business_b_id, business_a:businesses!combo_offers_business_a_id_fkey(business_name), business_b:businesses!combo_offers_business_b_id_fkey(business_name))")
    .in("payment_status", ["PAID", "VOUCHER_ISSUED"])
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter to combos involving this business
  var relevant = (combos || []).filter((c: any) => {
    var offer = c.combo_offers;
    return offer?.business_a_id === businessId || offer?.business_b_id === businessId;
  });

  // Calculate settlement per partnership
  var settlements: Record<string, any> = {};
  for (var combo of relevant as any[]) {
    var offer = combo.combo_offers;
    var isA = offer.business_a_id === businessId;
    var partnerId = isA ? offer.business_b_id : offer.business_a_id;
    var partnerName = isA ? offer.business_b?.business_name : offer.business_a?.business_name;

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

    var s = settlements[partnerId];
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
  var body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  var { combo_booking_ids, notes, settled_by } = body;
  if (!Array.isArray(combo_booking_ids) || combo_booking_ids.length === 0) {
    return NextResponse.json({ error: "combo_booking_ids array is required" }, { status: 400 });
  }

  var supabase = serviceClient();
  var { error } = await supabase
    .from("combo_bookings")
    .update({
      settled: true,
      settled_at: new Date().toISOString(),
      settlement_notes: notes || null,
    })
    .in("id", combo_booking_ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, settled: combo_booking_ids.length });
}
