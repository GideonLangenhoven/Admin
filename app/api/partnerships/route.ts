import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
    var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, key);
}

// GET /api/partnerships?business_id=xxx
// Returns partnerships where the business is either side (A or B), with partner name.
export async function GET(req: NextRequest) {
    var businessId = req.nextUrl.searchParams.get("business_id");
    if (!businessId) {
        return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });
    }

    var supabase = serviceClient();

    // Fetch partnerships where this business is on either side
    var { data, error } = await supabase
        .from("business_partnerships")
        .select("*, business_a:businesses!business_partnerships_business_a_id_fkey(id, name, business_name), business_b:businesses!business_partnerships_business_b_id_fkey(id, name, business_name)")
        .or(`business_a_id.eq.${businessId},business_b_id.eq.${businessId}`)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Add a helper field: partner name from the other side
    var partnerships = (data || []).map((p: any) => {
        var isA = p.business_a_id === businessId;
        var partner = isA ? p.business_b : p.business_a;
        return {
            ...p,
            partner_id: isA ? p.business_b_id : p.business_a_id,
            partner_name: partner?.business_name || partner?.name || "Unknown",
        };
    });

    return NextResponse.json({ partnerships });
}

// POST /api/partnerships
// Actions: create (invite), accept, revoke
export async function POST(req: NextRequest) {
    var body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    var { business_id, action } = body;
    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });

    var supabase = serviceClient();

    // --- INVITE (create) ---
    if (action === "invite") {
        var { partner_email } = body;
        if (!partner_email?.trim()) {
            return NextResponse.json({ error: "partner_email is required" }, { status: 400 });
        }

        // Look up partner business by admin email
        var { data: profile, error: profileErr } = await supabase
            .from("profiles")
            .select("business_id")
            .eq("email", partner_email.trim().toLowerCase())
            .eq("role", "admin")
            .maybeSingle();

        if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });
        if (!profile?.business_id) {
            return NextResponse.json({ error: "No business found for that email address." }, { status: 404 });
        }

        var partnerId = profile.business_id;
        if (partnerId === business_id) {
            return NextResponse.json({ error: "Cannot partner with yourself." }, { status: 400 });
        }

        // Check for existing active/pending partnership
        var { data: existing } = await supabase
            .from("business_partnerships")
            .select("id, status")
            .or(`and(business_a_id.eq.${business_id},business_b_id.eq.${partnerId}),and(business_a_id.eq.${partnerId},business_b_id.eq.${business_id})`)
            .in("status", ["PENDING", "ACTIVE"])
            .maybeSingle();

        if (existing) {
            return NextResponse.json({ error: "A partnership already exists with this business (status: " + existing.status + ")." }, { status: 409 });
        }

        // Canonical ordering: business_a_id < business_b_id (CHECK constraint)
        var aId = business_id < partnerId ? business_id : partnerId;
        var bId = business_id < partnerId ? partnerId : business_id;

        var { data: created, error: createErr } = await supabase
            .from("business_partnerships")
            .insert({
                business_a_id: aId,
                business_b_id: bId,
                status: "PENDING",
                initiated_by: business_id,
            })
            .select()
            .single();

        if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
        return NextResponse.json({ partnership: created });
    }

    // --- ACCEPT ---
    if (action === "accept") {
        var { partnership_id } = body;
        if (!partnership_id) return NextResponse.json({ error: "partnership_id is required" }, { status: 400 });

        var { data: updated, error: acceptErr } = await supabase
            .from("business_partnerships")
            .update({ status: "ACTIVE", accepted_at: new Date().toISOString() })
            .eq("id", partnership_id)
            .eq("status", "PENDING")
            .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
            .select()
            .single();

        if (acceptErr) return NextResponse.json({ error: acceptErr.message }, { status: 500 });
        if (!updated) return NextResponse.json({ error: "Partnership not found or not pending." }, { status: 404 });
        return NextResponse.json({ partnership: updated });
    }

    // --- REVOKE ---
    if (action === "revoke") {
        var { partnership_id } = body;
        if (!partnership_id) return NextResponse.json({ error: "partnership_id is required" }, { status: 400 });

        var { data: revoked, error: revokeErr } = await supabase
            .from("business_partnerships")
            .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
            .eq("id", partnership_id)
            .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
            .select()
            .single();

        if (revokeErr) return NextResponse.json({ error: revokeErr.message }, { status: 500 });
        if (!revoked) return NextResponse.json({ error: "Partnership not found." }, { status: 404 });

        // Deactivate all combo offers under this partnership
        await supabase
            .from("combo_offers")
            .update({ active: false })
            .eq("partnership_id", partnership_id);

        return NextResponse.json({ partnership: revoked });
    }

    return NextResponse.json({ error: "Invalid action. Must be 'invite', 'accept', or 'revoke'." }, { status: 400 });
}
