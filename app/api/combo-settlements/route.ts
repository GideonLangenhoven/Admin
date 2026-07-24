import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";
import { groupSettlements, groupWeeklyOwed } from "../../lib/combo-settlements";

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

  // Owed totals must tally EVERYTHING outstanding, so unsettled combos are
  // fetched regardless of age; settled ones only within the selected period
  // (recent history for the table).
  const comboSel = "id, combo_total, split_a_amount, split_b_amount, payment_status, settled, created_at, items:combo_booking_items(business_id, split_amount, settled_at, position), combo_offers(name, business_a_id, business_b_id, created_by_business_id, business_a:businesses!combo_offers_business_a_id_fkey(business_name), business_b:businesses!combo_offers_business_b_id_fkey(business_name))";
  const [unsettledRes, settledRes] = await Promise.all([
    supabase.from("combo_bookings").select(comboSel)
      .in("payment_status", ["PAID", "VOUCHER_ISSUED"])
      .eq("settled", false),
    supabase.from("combo_bookings").select(comboSel)
      .in("payment_status", ["PAID", "VOUCHER_ISSUED"])
      .eq("settled", true)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString()),
  ]);
  const error = unsettledRes.error || settledRes.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const combos = [...(unsettledRes.data || []), ...(settledRes.data || [])];

  // Each combo settles pairwise: the collector (who received the full payment)
  // owes every other participating operator their leg share. A combo therefore
  // produces one ledger entry per (collector ↔ other-party) pair involving me.
  // N-party pairs come from combo_booking_items; legacy 2-party from the
  // offer's A/B columns.
  const settlements: Record<string, any> = {};
  const unknownNames = new Set<string>();
  const getPartnerCard = (partnerId: string, partnerName?: string | null) => {
    if (!settlements[partnerId]) {
      if (!partnerName) unknownNames.add(partnerId);
      settlements[partnerId] = {
        partner_id: partnerId,
        partner_name: partnerName || "Partner",
        total_combos: 0,
        total_collected_by_me: 0,  // amount collected via Yoco by this business
        total_owed_to_partner: 0,  // unsettled amount this business owes partner
        total_owed_to_me: 0,       // unsettled amount partner owes this business
        unsettled_count: 0,
        bookings: [],
        _weeklyItems: [],
      };
    }
    return settlements[partnerId];
  };

  let relevantCount = 0;
  for (const combo of combos as any[]) {
    const offer = combo.combo_offers;
    if (!offer) continue;
    const items: any[] = combo.items || [];
    const collector: string = String(
      offer.business_a_id || offer.created_by_business_id || items.find((it) => it.position === 1)?.business_id || "",
    );

    // partner id → { owed, unsettled, name } for every non-collector party
    const others: Record<string, { owed: number; unsettled: boolean }> = {};
    let myShare = 0;
    if (items.length > 0) {
      for (const it of items) {
        if (it.business_id === businessId) myShare += Number(it.split_amount || 0);
        if (it.business_id === collector) continue;
        const g = (others[it.business_id] = others[it.business_id] || { owed: 0, unsettled: false });
        g.owed += Number(it.split_amount || 0);
        if (!it.settled_at && !combo.settled) g.unsettled = true;
      }
    } else {
      if (offer.business_b_id) {
        others[offer.business_b_id] = { owed: Number(combo.split_b_amount || 0), unsettled: !combo.settled };
      }
      myShare = collector === businessId ? Number(combo.split_a_amount || 0) : Number(combo.split_b_amount || 0);
    }

    const iAmCollector = collector === businessId;
    const iParticipate = iAmCollector || !!others[businessId];
    if (!iParticipate) continue;
    relevantCount++;

    const legacyNameFor = (id: string) =>
      id === offer.business_a_id ? offer.business_a?.business_name
      : id === offer.business_b_id ? offer.business_b?.business_name : null;

    // My pairs on this combo: collector→each other party (if I collect), or
    // collector→me (if I'm an owed party).
    const pairPartners = iAmCollector ? Object.keys(others) : [collector];
    for (const partnerId of pairPartners) {
      const s = getPartnerCard(partnerId, legacyNameFor(partnerId));
      const pair = iAmCollector ? others[partnerId] : others[businessId];
      const pairOwed = pair?.owed || 0;
      const pairUnsettled = pair?.unsettled || false;

      s.total_combos++;
      if (iAmCollector) s.total_collected_by_me += Number(combo.combo_total);
      if (pairUnsettled) {
        s.unsettled_count++;
        if (iAmCollector) s.total_owed_to_partner += pairOwed;
        else s.total_owed_to_me += pairOwed;
        s._weeklyItems.push({
          created_at: combo.created_at,
          owed_to_me: iAmCollector ? 0 : pairOwed,
          owed_to_partner: iAmCollector ? pairOwed : 0,
        });
      }
      s.bookings.push({
        id: combo.id,
        combo_name: offer.name,
        total: Number(combo.combo_total),
        my_share: myShare,
        partner_share: iAmCollector ? pairOwed : Number(combo.combo_total) - myShare,
        settled: !pairUnsettled,
        date: combo.created_at,
      });
    }
  }

  // Resolve names for N-party partners not covered by the legacy A/B joins
  if (unknownNames.size > 0) {
    const { data: bizNames } = await supabase
      .from("businesses").select("id, business_name, name").in("id", Array.from(unknownNames));
    for (const b of bizNames || []) {
      if (settlements[b.id]) settlements[b.id].partner_name = b.business_name || b.name || "Partner";
    }
  }

  for (const s of Object.values(settlements)) {
    s.weekly = groupWeeklyOwed(s._weeklyItems);
    delete s._weeklyItems;
  }

  // Latest payment-link request per partner (either direction) so the UI can
  // show "awaiting payment" / "Paid" and give operator A a Pay-now button.
  const { data: payReqs } = await supabase
    .from("combo_settlements")
    .select("id, collector_business_id, owed_business_id, amount_owed, status, payment_url, created_at, paid_at")
    .or(`collector_business_id.eq.${businessId},owed_business_id.eq.${businessId}`)
    .in("status", ["PENDING_PAYMENT", "PAID"])
    .order("created_at", { ascending: false })
    .limit(100);
  for (const s of Object.values(settlements)) {
    const reqRow = (payReqs || []).find(
      (r: any) => r.collector_business_id === s.partner_id || r.owed_business_id === s.partner_id,
    );
    if (reqRow) {
      s.payment_request = {
        ...reqRow,
        direction: reqRow.owed_business_id === businessId ? "OWED_TO_ME" : "I_OWE",
      };
    }
  }

  return NextResponse.json({
    period: { start: startDate.toISOString(), end: endDate.toISOString() },
    settlements: Object.values(settlements),
    total_combos: relevantCount,
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

  const { combo_booking_ids, notes, partner_business_id } = body;
  if (!Array.isArray(combo_booking_ids) || combo_booking_ids.length === 0) {
    return NextResponse.json({ error: "combo_booking_ids array is required" }, { status: 400 });
  }

  const supabase = serviceClient();

  // Load the target combos and verify the caller's business is a party to
  // every one of them (SUPER_ADMIN excepted). Settlement is pairwise: for
  // N-party combos only the (collector ↔ pair partner) legs are settled; the
  // combo-wide flag flips once every non-collector leg is settled.
  const { data: combos, error: loadErr } = await supabase
    .from("combo_bookings")
    .select("id, combo_total, split_b_amount, created_at, settled, payment_status, items:combo_booking_items(id, business_id, split_amount, settled_at, position), combo_offers(partnership_id, business_a_id, business_b_id, created_by_business_id)")
    .in("id", combo_booking_ids);
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });

  const settledAt = new Date().toISOString();
  const legacyEligible: any[] = [];
  let itemsSettledCount = 0;
  // Per-pair register accumulation for items-based combos
  const pairRegister: Record<string, { collector: string; other: string; amount: number; collected: number; count: number; dates: string[]; offerPartnershipId: string | null }> = {};

  for (const c of (combos || []) as any[]) {
    const offer = c.combo_offers;
    if (!offer) continue;
    if (!["PAID", "VOUCHER_ISSUED"].includes(String(c.payment_status))) continue;
    const items: any[] = c.items || [];

    if (items.length === 0) {
      // Legacy 2-party combo: whole-combo settle (one pair)
      if (caller.role !== "SUPER_ADMIN" && offer.business_a_id !== caller.business_id && offer.business_b_id !== caller.business_id) continue;
      if (c.settled) continue;
      legacyEligible.push(c);
      continue;
    }

    const collector = String(offer.business_a_id || offer.created_by_business_id || items.find((it) => it.position === 1)?.business_id || "");
    const participantIds = items.map((it) => String(it.business_id));
    if (caller.role !== "SUPER_ADMIN" && !participantIds.includes(caller.business_id) && collector !== caller.business_id) continue;

    // The settled pair's non-collector side: the partner if I'm the collector,
    // otherwise me (I'm confirming I received my share).
    const otherSide = caller.business_id === collector
      ? String(partner_business_id || "")
      : caller.business_id;
    if (!otherSide || otherSide === collector) continue;

    const targetItems = items.filter((it) => it.business_id === otherSide && !it.settled_at);
    if (targetItems.length === 0) continue;

    const { error: itemErr } = await supabase
      .from("combo_booking_items")
      .update({ settled_at: settledAt })
      .in("id", targetItems.map((it) => it.id));
    if (itemErr) { console.error("COMBO_ITEM_SETTLE_ERR:", itemErr.message); continue; }
    itemsSettledCount++;

    const remainingOpen = items.some((it) =>
      it.business_id !== collector && it.business_id !== otherSide && !it.settled_at);
    if (!remainingOpen) {
      await supabase.from("combo_bookings")
        .update({ settled: true, settled_at: settledAt, settlement_notes: notes || null })
        .eq("id", c.id).eq("settled", false);
    }

    const key = collector + "|" + otherSide;
    const reg = (pairRegister[key] = pairRegister[key] || {
      collector, other: otherSide, amount: 0, collected: 0, count: 0, dates: [],
      offerPartnershipId: offer.partnership_id || null,
    });
    reg.amount += targetItems.reduce((s, it) => s + Number(it.split_amount || 0), 0);
    reg.collected += Number(c.combo_total || 0);
    reg.count++;
    reg.dates.push(String(c.created_at).slice(0, 10));
  }

  if (legacyEligible.length === 0 && itemsSettledCount === 0) {
    return NextResponse.json({ error: "No eligible combo bookings (must involve your business, be paid, and not already settled)." }, { status: 400 });
  }

  if (legacyEligible.length > 0) {
    const { error } = await supabase
      .from("combo_bookings")
      .update({ settled: true, settled_at: settledAt, settlement_notes: notes || null })
      .in("id", legacyEligible.map((c: any) => c.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Write the settlement register (read by Reports → Settlement Register).
  // Legacy combos: one row per partnership via groupSettlements. Items combos:
  // one row per settled (collector ↔ partner) pair.
  for (const row of groupSettlements(legacyEligible as any[])) {
    const { error: regErr } = await supabase.from("combo_settlements").insert({
      ...row,
      status: "SETTLED",
      settled_at: settledAt,
      settled_by: caller.id,
      notes: notes || null,
    });
    if (regErr) console.error("COMBO_SETTLEMENT_REGISTER_ERR:", regErr.message);
  }
  for (const reg of Object.values(pairRegister)) {
    let partnershipId = reg.offerPartnershipId;
    const aId = reg.collector < reg.other ? reg.collector : reg.other;
    const bId = reg.collector < reg.other ? reg.other : reg.collector;
    const { data: pRow } = await supabase.from("business_partnerships").select("id")
      .eq("business_a_id", aId).eq("business_b_id", bId).maybeSingle();
    if (pRow?.id) partnershipId = pRow.id;
    if (!partnershipId) { console.error("COMBO_SETTLEMENT_REGISTER_ERR: no partnership for pair " + aId + "/" + bId); continue; }
    const dates = reg.dates.sort();
    const { error: regErr } = await supabase.from("combo_settlements").insert({
      partnership_id: partnershipId,
      period_start: dates[0],
      period_end: dates[dates.length - 1],
      collector_business_id: reg.collector,
      owed_business_id: reg.other,
      total_collected: Math.round(reg.collected * 100) / 100,
      amount_owed: Math.round(reg.amount * 100) / 100,
      combo_booking_count: reg.count,
      status: "SETTLED",
      settled_at: settledAt,
      settled_by: caller.id,
      notes: notes || null,
    });
    if (regErr) console.error("COMBO_SETTLEMENT_REGISTER_ERR:", regErr.message);
  }

  return NextResponse.json({ ok: true, settled: legacyEligible.length + itemsSettledCount });
}
