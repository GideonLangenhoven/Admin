import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";

function serviceClient() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// GET /api/combo-offers?business_id=xxx
export async function GET(req: NextRequest) {
  if (!isComboEnabledServer()) return comboDisabledResponse();
  var businessId = req.nextUrl.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

  var supabase = serviceClient();

  // Find combo offers where this business has an item
  var { data: myItems } = await supabase
    .from("combo_offer_items")
    .select("combo_offer_id")
    .eq("business_id", businessId);

  var offerIds = [...new Set((myItems || []).map((i: any) => i.combo_offer_id))];

  // Also include legacy offers where business is A or B
  var { data: legacyOffers } = await supabase
    .from("combo_offers")
    .select("id")
    .or(`business_a_id.eq.${businessId},business_b_id.eq.${businessId}`);

  var allIds = [...new Set([...offerIds, ...(legacyOffers || []).map((o: any) => o.id)])];
  if (allIds.length === 0) return NextResponse.json({ combo_offers: [] });

  var { data, error } = await supabase
    .from("combo_offers")
    .select("*, items:combo_offer_items(id, tour_id, business_id, position, label, split_percent, split_fixed, tours:tours(name), businesses:businesses(business_name))")
    .in("id", allIds)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ combo_offers: data || [] });
}

// POST /api/combo-offers — create or update
// body.action: "create" | "update" | "deactivate" | "activate"
export async function POST(req: NextRequest) {
  if (!isComboEnabledServer()) return comboDisabledResponse();
  var body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  var { business_id, action } = body;
  if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

  var supabase = serviceClient();

  // --- CREATE ---
  if (action === "create") {
    var { name, description, image_url, combo_price, original_price, split_type, currency, items } = body;

    if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (combo_price == null || combo_price < 0) return NextResponse.json({ error: "combo_price must be non-negative" }, { status: 400 });
    if (!split_type || !["PERCENT", "FIXED"].includes(split_type)) return NextResponse.json({ error: "split_type must be PERCENT or FIXED" }, { status: 400 });
    if (!Array.isArray(items) || items.length < 2) return NextResponse.json({ error: "At least 2 items required" }, { status: 400 });
    if (items.length > 10) return NextResponse.json({ error: "Maximum 10 items per combo" }, { status: 400 });

    // Validate splits sum
    if (split_type === "PERCENT") {
      var pctSum = items.reduce((s: number, i: any) => s + Number(i.split_percent || 0), 0);
      if (pctSum !== 100) return NextResponse.json({ error: "Percent splits must sum to 100 (got " + pctSum + ")" }, { status: 400 });
    } else {
      var fixedSum = items.reduce((s: number, i: any) => s + Number(i.split_fixed || 0), 0);
      if (fixedSum !== Number(combo_price)) return NextResponse.json({ error: "Fixed splits must sum to combo_price (got " + fixedSum + " vs " + combo_price + ")" }, { status: 400 });
    }

    // Verify all businesses have active partnerships with the creator
    var businessIds = [...new Set(items.map((i: any) => i.business_id).filter((id: string) => id !== business_id))];
    for (var partnerId of businessIds) {
      var aId = business_id < partnerId ? business_id : partnerId;
      var bId = business_id < partnerId ? partnerId : business_id;
      var { data: p } = await supabase
        .from("business_partnerships")
        .select("id, status")
        .eq("business_a_id", aId)
        .eq("business_b_id", bId)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (!p) return NextResponse.json({ error: "No active partnership with business " + partnerId }, { status: 403 });
    }

    // Create the combo offer
    var { data: offer, error: offerErr } = await supabase
      .from("combo_offers")
      .insert({
        name: name.trim(),
        description: description || null,
        image_url: image_url || null,
        combo_price: Number(combo_price),
        original_price: Number(original_price || combo_price),
        split_type,
        currency: currency || "ZAR",
        active: true,
        created_by: business_id,
        created_by_business_id: business_id,
      })
      .select()
      .single();

    if (offerErr) return NextResponse.json({ error: offerErr.message }, { status: 500 });

    // Insert items
    var itemRows = items.map((item: any, idx: number) => ({
      combo_offer_id: offer.id,
      tour_id: item.tour_id,
      business_id: item.business_id,
      position: idx + 1,
      label: item.label || null,
      split_percent: split_type === "PERCENT" ? Number(item.split_percent) : null,
      split_fixed: split_type === "FIXED" ? Number(item.split_fixed) : null,
    }));

    var { error: itemsErr } = await supabase.from("combo_offer_items").insert(itemRows);
    if (itemsErr) {
      // Rollback the offer
      await supabase.from("combo_offers").delete().eq("id", offer.id);
      return NextResponse.json({ error: "Failed to create items: " + itemsErr.message }, { status: 500 });
    }

    // Load the full offer with items
    var { data: full } = await supabase
      .from("combo_offers")
      .select("*, items:combo_offer_items(id, tour_id, business_id, position, label, split_percent, split_fixed)")
      .eq("id", offer.id)
      .single();

    return NextResponse.json({ combo_offer: full });
  }

  // --- UPDATE ---
  if (action === "update") {
    var { combo_offer_id, name, description, image_url, combo_price, original_price, split_type, currency, items } = body;
    if (!combo_offer_id) return NextResponse.json({ error: "combo_offer_id is required" }, { status: 400 });

    // Verify ownership (creator or participant)
    var { data: existingItems } = await supabase
      .from("combo_offer_items")
      .select("business_id")
      .eq("combo_offer_id", combo_offer_id);
    var participantIds = (existingItems || []).map((i: any) => i.business_id);
    var { data: existingOffer } = await supabase.from("combo_offers").select("created_by_business_id, created_by, split_type, combo_price").eq("id", combo_offer_id).single();
    if (!existingOffer) return NextResponse.json({ error: "Combo offer not found" }, { status: 404 });
    if (!participantIds.includes(business_id) && existingOffer.created_by_business_id !== business_id && existingOffer.created_by !== business_id) {
      return NextResponse.json({ error: "Not authorized to edit this combo offer" }, { status: 403 });
    }

    var updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (image_url !== undefined) updates.image_url = image_url;
    if (combo_price !== undefined) updates.combo_price = Number(combo_price);
    if (original_price !== undefined) updates.original_price = Number(original_price);
    if (split_type !== undefined) updates.split_type = split_type;
    if (currency !== undefined) updates.currency = currency;

    if (Object.keys(updates).length > 0) {
      var { error: updateErr } = await supabase.from("combo_offers").update(updates).eq("id", combo_offer_id);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Replace items if provided
    if (Array.isArray(items) && items.length >= 2) {
      var effectiveSplitType = split_type || existingOffer.split_type || "PERCENT";
      var effectivePrice = combo_price !== undefined ? Number(combo_price) : Number(existingOffer.combo_price);

      if (items.length > 10) return NextResponse.json({ error: "Maximum 10 items" }, { status: 400 });

      if (effectiveSplitType === "PERCENT") {
        var pctSum = items.reduce((s: number, i: any) => s + Number(i.split_percent || 0), 0);
        if (pctSum !== 100) return NextResponse.json({ error: "Percent splits must sum to 100 (got " + pctSum + ")" }, { status: 400 });
      } else {
        var fixedSum = items.reduce((s: number, i: any) => s + Number(i.split_fixed || 0), 0);
        if (fixedSum !== effectivePrice) return NextResponse.json({ error: "Fixed splits must sum to combo_price" }, { status: 400 });
      }

      // Delete old items, insert new
      await supabase.from("combo_offer_items").delete().eq("combo_offer_id", combo_offer_id);
      var newRows = items.map((item: any, idx: number) => ({
        combo_offer_id,
        tour_id: item.tour_id,
        business_id: item.business_id,
        position: idx + 1,
        label: item.label || null,
        split_percent: effectiveSplitType === "PERCENT" ? Number(item.split_percent) : null,
        split_fixed: effectiveSplitType === "FIXED" ? Number(item.split_fixed) : null,
      }));
      var { error: replaceErr } = await supabase.from("combo_offer_items").insert(newRows);
      if (replaceErr) return NextResponse.json({ error: replaceErr.message }, { status: 500 });
    }

    var { data: full } = await supabase
      .from("combo_offers")
      .select("*, items:combo_offer_items(id, tour_id, business_id, position, label, split_percent, split_fixed)")
      .eq("id", combo_offer_id)
      .single();

    return NextResponse.json({ combo_offer: full });
  }

  // --- DEACTIVATE ---
  if (action === "deactivate") {
    var { combo_offer_id } = body;
    if (!combo_offer_id) return NextResponse.json({ error: "combo_offer_id is required" }, { status: 400 });
    var { data, error } = await supabase.from("combo_offers").update({ active: false }).eq("id", combo_offer_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ combo_offer: data });
  }

  // --- ACTIVATE ---
  if (action === "activate") {
    var { combo_offer_id } = body;
    if (!combo_offer_id) return NextResponse.json({ error: "combo_offer_id is required" }, { status: 400 });
    var { data, error } = await supabase.from("combo_offers").update({ active: true }).eq("id", combo_offer_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ combo_offer: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
