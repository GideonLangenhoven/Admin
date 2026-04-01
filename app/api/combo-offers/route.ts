import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
    var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, key);
}

// GET /api/combo-offers?business_id=xxx
// Returns combo offers where the business is either side (A or B).
export async function GET(req: NextRequest) {
    var businessId = req.nextUrl.searchParams.get("business_id");
    if (!businessId) {
        return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });
    }

    var supabase = serviceClient();

    var { data, error } = await supabase
        .from("combo_offers")
        .select("*, partnership:business_partnerships(id, business_a_id, business_b_id, status), tour_a:tours!combo_offers_tour_a_id_fkey(id, name), tour_b:tours!combo_offers_tour_b_id_fkey(id, name)")
        .or(`business_a_id.eq.${businessId},business_b_id.eq.${businessId}`)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ combo_offers: data || [] });
}

// POST /api/combo-offers
// Create a new combo offer
export async function POST(req: NextRequest) {
    var body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    var { business_id, partnership_id, tour_a_id, tour_b_id, name: comboName, combo_price, original_price, currency, business_a_id, business_b_id, description, image_url, split_type, split_a_percent, split_b_percent, split_a_fixed, split_b_fixed, sort_order } = body;

    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    if (!partnership_id) return NextResponse.json({ error: "partnership_id is required" }, { status: 400 });
    if (!tour_a_id || !tour_b_id) return NextResponse.json({ error: "tour_a_id and tour_b_id are required" }, { status: 400 });
    if (!comboName?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (combo_price == null || combo_price < 0) return NextResponse.json({ error: "combo_price must be a non-negative number" }, { status: 400 });
    if (!split_type || !["PERCENT", "FIXED"].includes(split_type)) return NextResponse.json({ error: "split_type must be PERCENT or FIXED" }, { status: 400 });

    var supabase = serviceClient();

    // Verify the partnership is active and the business is part of it
    var { data: partnership, error: pErr } = await supabase
        .from("business_partnerships")
        .select("id, business_a_id, business_b_id, status")
        .eq("id", partnership_id)
        .eq("status", "ACTIVE")
        .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
        .maybeSingle();

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!partnership) return NextResponse.json({ error: "Active partnership not found." }, { status: 404 });

    var { data: created, error: createErr } = await supabase
        .from("combo_offers")
        .insert({
            partnership_id,
            business_a_id: business_a_id || partnership.business_a_id,
            business_b_id: business_b_id || partnership.business_b_id,
            tour_a_id,
            tour_b_id,
            name: comboName.trim(),
            description: description || null,
            image_url: image_url || null,
            combo_price,
            original_price: original_price || combo_price,
            split_type,
            split_a_percent: split_type === "PERCENT" ? Number(split_a_percent) : null,
            split_b_percent: split_type === "PERCENT" ? Number(split_b_percent) : null,
            split_a_fixed: split_type === "FIXED" ? Number(split_a_fixed) : null,
            split_b_fixed: split_type === "FIXED" ? Number(split_b_fixed) : null,
            sort_order: sort_order || 0,
            currency: currency || "ZAR",
            active: true,
        })
        .select()
        .single();

    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    return NextResponse.json({ combo_offer: created });
}

// PUT /api/combo-offers
// Update an existing combo offer
export async function PUT(req: NextRequest) {
    var body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    var { business_id, combo_offer_id, name: comboName, combo_price, original_price, currency, active, tour_a_id, tour_b_id, description, image_url, split_type, split_a_percent, split_b_percent, split_a_fixed, split_b_fixed, sort_order } = body;

    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    if (!combo_offer_id) return NextResponse.json({ error: "combo_offer_id is required" }, { status: 400 });

    var supabase = serviceClient();

    var updates: any = {};
    if (comboName !== undefined) updates.name = comboName.trim();
    if (description !== undefined) updates.description = description;
    if (image_url !== undefined) updates.image_url = image_url;
    if (combo_price !== undefined) updates.combo_price = combo_price;
    if (original_price !== undefined) updates.original_price = original_price;
    if (currency !== undefined) updates.currency = currency;
    if (active !== undefined) updates.active = active;
    if (tour_a_id !== undefined) updates.tour_a_id = tour_a_id;
    if (tour_b_id !== undefined) updates.tour_b_id = tour_b_id;
    if (split_type !== undefined) updates.split_type = split_type;
    if (split_a_percent !== undefined) updates.split_a_percent = Number(split_a_percent);
    if (split_b_percent !== undefined) updates.split_b_percent = Number(split_b_percent);
    if (split_a_fixed !== undefined) updates.split_a_fixed = Number(split_a_fixed);
    if (split_b_fixed !== undefined) updates.split_b_fixed = Number(split_b_fixed);
    if (sort_order !== undefined) updates.sort_order = sort_order;

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    var { data: updated, error: updateErr } = await supabase
        .from("combo_offers")
        .update(updates)
        .eq("id", combo_offer_id)
        .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
        .select()
        .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Combo offer not found or not owned by this business." }, { status: 404 });

    return NextResponse.json({ combo_offer: updated });
}

// DELETE /api/combo-offers
// Deactivate a combo offer (set active=false)
export async function DELETE(req: NextRequest) {
    var businessId = req.nextUrl.searchParams.get("business_id");
    var comboOfferId = req.nextUrl.searchParams.get("combo_offer_id");

    if (!businessId) return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });
    if (!comboOfferId) return NextResponse.json({ error: "combo_offer_id query param is required" }, { status: 400 });

    var supabase = serviceClient();

    var { data: updated, error } = await supabase
        .from("combo_offers")
        .update({ active: false })
        .eq("id", comboOfferId)
        .or(`business_a_id.eq.${businessId},business_b_id.eq.${businessId}`)
        .select()
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Combo offer not found or not owned by this business." }, { status: 404 });

    return NextResponse.json({ combo_offer: updated });
}
