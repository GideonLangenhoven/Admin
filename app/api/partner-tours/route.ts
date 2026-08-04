import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer, comboDisabledResponse } from "../../lib/feature-flags";
import { getCallerAdmin } from "../../lib/api-auth";

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

// GET /api/partner-tours?partner_id=yyy
// Returns active tours for the partner business, after verifying the CALLER's
// own tenant has an active partnership with it. business_id was previously a
// client-supplied query param — that let anyone enumerate business_id/
// partner_id pairs and dump a partner's tour catalog with no login at all.
// It's now derived server-side from the authenticated session.
export async function GET(req: NextRequest) {
    if (!isComboEnabledServer()) return comboDisabledResponse();
    const caller = await getCallerAdmin(req);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const businessId = caller.business_id;
    const partnerId = req.nextUrl.searchParams.get("partner_id");

    if (!partnerId) return NextResponse.json({ error: "partner_id query param is required" }, { status: 400 });

    const supabase = serviceClient();

    // Verify active partnership exists between these two businesses
    const { data: partnership, error: pErr } = await supabase
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
    const { data: tours, error: tErr } = await supabase
        .from("tours")
        .select("id, name, base_price_per_person, peak_price_per_person, duration_minutes")
        .eq("business_id", partnerId)
        .eq("active", true)
        .order("sort_order");

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

    return NextResponse.json({ tours: tours || [] });
}
