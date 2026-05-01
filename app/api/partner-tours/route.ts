import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";

function serviceClient() {
    var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, key);
}

// GET /api/partner-tours?business_id=xxx&partner_id=yyy
// Returns active tours for the partner business, after verifying an active partnership exists.
export async function GET(req: NextRequest) {
    if (!isComboEnabledServer()) return comboDisabledResponse();
    var businessId = req.nextUrl.searchParams.get("business_id");
    var partnerId = req.nextUrl.searchParams.get("partner_id");

    if (!businessId) return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });
    if (!partnerId) return NextResponse.json({ error: "partner_id query param is required" }, { status: 400 });

    var supabase = serviceClient();

    // Verify active partnership exists between these two businesses
    var { data: partnership, error: pErr } = await supabase
        .from("business_partnerships")
        .select("id")
        .or(`and(business_a_id.eq.${businessId},business_b_id.eq.${partnerId}),and(business_a_id.eq.${partnerId},business_b_id.eq.${businessId})`)
        .eq("status", "ACTIVE")
        .maybeSingle();

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!partnership) {
        return NextResponse.json({ error: "No active partnership found with this business." }, { status: 403 });
    }

    // Get partner's active tours
    var { data: tours, error: tErr } = await supabase
        .from("tours")
        .select("id, name, base_price_per_person, peak_price_per_person, duration_minutes")
        .eq("business_id", partnerId)
        .eq("active", true)
        .order("sort_order");

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

    return NextResponse.json({ tours: tours || [] });
}
