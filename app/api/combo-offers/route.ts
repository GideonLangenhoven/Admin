import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Fail loudly rather than degrading to the anon key. combo_bookings,
  // combo_booking_items and promotion_uses have RLS on with no client
  // policies, so an anon fallback does not error — it returns empty. A
  // settlement or cancellation route reporting "nothing found" when the
  // service key is missing is a silent money bug.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server");
  return createClient(url, key);
}

// GET /api/combo-offers?business_id=xxx
export async function GET(req: NextRequest) {
  if (!isComboEnabledServer()) return comboDisabledResponse();

  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const businessId = req.nextUrl.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
    return NextResponse.json({ error: "You can only view combo offers for your own business" }, { status: 403 });
  }

  const supabase = serviceClient();

  // Find combo offers where this business has an item
  const { data: myItems } = await supabase
    .from("combo_offer_items")
    .select("combo_offer_id")
    .eq("business_id", businessId);

  const offerIds = [...new Set((myItems || []).map((i: any) => i.combo_offer_id))];

  // Also include legacy offers where business is A or B
  const { data: legacyOffers } = await supabase
    .from("combo_offers")
    .select("id")
    .or(`business_a_id.eq.${businessId},business_b_id.eq.${businessId}`);

  const allIds = [...new Set([...offerIds, ...(legacyOffers || []).map((o: any) => o.id)])];
  if (allIds.length === 0) return NextResponse.json({ combo_offers: [] });

  const { data, error } = await supabase
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

  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { business_id, action } = body;
  if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== business_id) {
    return NextResponse.json({ error: "You can only manage combo offers for your own business" }, { status: 403 });
  }

  const supabase = serviceClient();

  // --- CREATE ---
  if (action === "create") {
    const { name, description, image_url, combo_price, original_price, split_type, currency, items } = body;

    if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (combo_price == null || combo_price < 0) return NextResponse.json({ error: "combo_price must be non-negative" }, { status: 400 });
    if (!split_type || !["PERCENT", "FIXED"].includes(split_type)) return NextResponse.json({ error: "split_type must be PERCENT or FIXED" }, { status: 400 });
    if (!Array.isArray(items) || items.length < 2) return NextResponse.json({ error: "At least 2 items required" }, { status: 400 });
    if (items.length > 10) return NextResponse.json({ error: "Maximum 10 items per combo" }, { status: 400 });

    // Validate splits sum
    if (split_type === "PERCENT") {
      const pctSum = items.reduce((s: number, i: any) => s + Number(i.split_percent || 0), 0);
      if (pctSum !== 100) return NextResponse.json({ error: "Percent splits must sum to 100 (got " + pctSum + ")" }, { status: 400 });
    } else {
      const fixedSum = items.reduce((s: number, i: any) => s + Number(i.split_fixed || 0), 0);
      if (fixedSum !== Number(combo_price)) return NextResponse.json({ error: "Fixed splits must sum to combo_price (got " + fixedSum + " vs " + combo_price + ")" }, { status: 400 });
    }

    // Verify all businesses have active partnerships with the creator
    const businessIds = [...new Set(items.map((i: any) => i.business_id).filter((id: string) => id !== business_id))];
    const partnershipIds: Record<string, string> = {};
    for (const partnerId of businessIds) {
      const aId = business_id < partnerId ? business_id : partnerId;
      const bId = business_id < partnerId ? partnerId : business_id;
      const { data: p } = await supabase
        .from("business_partnerships")
        .select("id, status")
        .eq("business_a_id", aId)
        .eq("business_b_id", bId)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (!p) return NextResponse.json({ error: "No active partnership with business " + partnerId }, { status: 403 });
      partnershipIds[partnerId] = p.id;
    }

    // 2-party offers also populate the legacy A/B columns for older lookups.
    // A = the creator (they collect payment in the manual-settlement model).
    // 3+ party offers are items-only; checkout and the booking site read
    // combo_offer_items directly.
    let legacyCols: Record<string, unknown> = {};
    if (items.length === 2 && businessIds.length === 1) {
      const mine = items.find((i: any) => i.business_id === business_id);
      const theirs = items.find((i: any) => i.business_id !== business_id);
      if (mine && theirs) {
        legacyCols = {
          partnership_id: partnershipIds[theirs.business_id],
          business_a_id: business_id,
          business_b_id: theirs.business_id,
          tour_a_id: mine.tour_id,
          tour_b_id: theirs.tour_id,
          split_a_percent: split_type === "PERCENT" ? Number(mine.split_percent) : null,
          split_b_percent: split_type === "PERCENT" ? Number(theirs.split_percent) : null,
          split_a_fixed: split_type === "FIXED" ? Number(mine.split_fixed) : null,
          split_b_fixed: split_type === "FIXED" ? Number(theirs.split_fixed) : null,
        };
      }
    }

    // Create the combo offer
    const { data: offer, error: offerErr } = await supabase
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
        ...legacyCols,
      })
      .select()
      .single();

    if (offerErr) return NextResponse.json({ error: offerErr.message }, { status: 500 });

    // Insert items
    const itemRows = items.map((item: any, idx: number) => ({
      combo_offer_id: offer.id,
      tour_id: item.tour_id,
      business_id: item.business_id,
      position: idx + 1,
      label: item.label || null,
      split_percent: split_type === "PERCENT" ? Number(item.split_percent) : null,
      split_fixed: split_type === "FIXED" ? Number(item.split_fixed) : null,
    }));

    const { error: itemsErr } = await supabase.from("combo_offer_items").insert(itemRows);
    if (itemsErr) {
      // Rollback the offer
      await supabase.from("combo_offers").delete().eq("id", offer.id);
      return NextResponse.json({ error: "Failed to create items: " + itemsErr.message }, { status: 500 });
    }

    // Load the full offer with items
    const { data: full } = await supabase
      .from("combo_offers")
      .select("*, items:combo_offer_items(id, tour_id, business_id, position, label, split_percent, split_fixed)")
      .eq("id", offer.id)
      .single();

    return NextResponse.json({ combo_offer: full });
  }

  // --- UPDATE ---
  if (action === "update") {
    const { combo_offer_id, name, description, image_url, combo_price, original_price, split_type, currency, items } = body;
    if (!combo_offer_id) return NextResponse.json({ error: "combo_offer_id is required" }, { status: 400 });

    // Verify ownership (creator or participant)
    const { data: existingItems } = await supabase
      .from("combo_offer_items")
      .select("business_id")
      .eq("combo_offer_id", combo_offer_id);
    const participantIds = (existingItems || []).map((i: any) => i.business_id);
    const { data: existingOffer } = await supabase.from("combo_offers").select("created_by_business_id, created_by, split_type, combo_price").eq("id", combo_offer_id).single();
    if (!existingOffer) return NextResponse.json({ error: "Combo offer not found" }, { status: 404 });
    if (!participantIds.includes(business_id) && existingOffer.created_by_business_id !== business_id && existingOffer.created_by !== business_id) {
      return NextResponse.json({ error: "Not authorized to edit this combo offer" }, { status: 403 });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (image_url !== undefined) updates.image_url = image_url;
    if (combo_price !== undefined) updates.combo_price = Number(combo_price);
    if (original_price !== undefined) updates.original_price = Number(original_price);
    if (split_type !== undefined) updates.split_type = split_type;
    if (currency !== undefined) updates.currency = currency;

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabase.from("combo_offers").update(updates).eq("id", combo_offer_id);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Replace items if provided
    if (Array.isArray(items) && items.length >= 2) {
      const effectiveSplitType = split_type || existingOffer.split_type || "PERCENT";
      const effectivePrice = combo_price !== undefined ? Number(combo_price) : Number(existingOffer.combo_price);

      if (items.length > 10) return NextResponse.json({ error: "Maximum 10 items" }, { status: 400 });

      if (effectiveSplitType === "PERCENT") {
        const pctSum = items.reduce((s: number, i: any) => s + Number(i.split_percent || 0), 0);
        if (pctSum !== 100) return NextResponse.json({ error: "Percent splits must sum to 100 (got " + pctSum + ")" }, { status: 400 });
      } else {
        const fixedSum = items.reduce((s: number, i: any) => s + Number(i.split_fixed || 0), 0);
        if (fixedSum !== effectivePrice) return NextResponse.json({ error: "Fixed splits must sum to combo_price" }, { status: 400 });
      }

      // Delete old items, insert new
      await supabase.from("combo_offer_items").delete().eq("combo_offer_id", combo_offer_id);
      const newRows = items.map((item: any, idx: number) => ({
        combo_offer_id,
        tour_id: item.tour_id,
        business_id: item.business_id,
        position: idx + 1,
        label: item.label || null,
        split_percent: effectiveSplitType === "PERCENT" ? Number(item.split_percent) : null,
        split_fixed: effectiveSplitType === "FIXED" ? Number(item.split_fixed) : null,
      }));
      const { error: replaceErr } = await supabase.from("combo_offer_items").insert(newRows);
      if (replaceErr) return NextResponse.json({ error: replaceErr.message }, { status: 500 });
    }

    const { data: full } = await supabase
      .from("combo_offers")
      .select("*, items:combo_offer_items(id, tour_id, business_id, position, label, split_percent, split_fixed)")
      .eq("id", combo_offer_id)
      .single();

    return NextResponse.json({ combo_offer: full });
  }

  // --- ACTIVATE / DEACTIVATE ---
  if (action === "deactivate" || action === "activate") {
    const { combo_offer_id } = body;
    if (!combo_offer_id) return NextResponse.json({ error: "combo_offer_id is required" }, { status: 400 });
    // Tenant check: only a business that's party to the offer may toggle it.
    if (caller.role !== "SUPER_ADMIN") {
      const { data: off } = await supabase.from("combo_offers").select("business_a_id, business_b_id, created_by_business_id").eq("id", combo_offer_id).single();
      const { data: item } = await supabase.from("combo_offer_items").select("id").eq("combo_offer_id", combo_offer_id).eq("business_id", caller.business_id).limit(1).maybeSingle();
      const isParty = off && [off.business_a_id, off.business_b_id, off.created_by_business_id].includes(caller.business_id);
      if (!isParty && !item) return NextResponse.json({ error: "Not authorized to change this combo offer" }, { status: 403 });
    }
    const { data, error } = await supabase.from("combo_offers").update({ active: action === "activate" }).eq("id", combo_offer_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ combo_offer: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
