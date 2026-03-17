import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
    var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    // Prefer a server-only key; fall back to the env var already in use
    var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    return createClient(url, key);
}

// GET /api/credentials?business_id=xxx
// Returns { wa: boolean, yoco: boolean } — never the raw secret values.
// Safe to call from the client — no secrets are exposed.
export async function GET(req: NextRequest) {
    var businessId = req.nextUrl.searchParams.get("business_id");
    if (!businessId) {
        return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });
    }

    var supabase = serviceClient();
    var { data, error } = await supabase
        .from("businesses")
        .select("wa_token_encrypted, wa_phone_id_encrypted, yoco_secret_key_encrypted, yoco_webhook_secret_encrypted")
        .eq("id", businessId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Business not found" }, { status: 404 });

    return NextResponse.json({
        wa: !!data.wa_token_encrypted && !!data.wa_phone_id_encrypted,
        yoco: !!data.yoco_secret_key_encrypted && !!data.yoco_webhook_secret_encrypted,
    });
}

// POST /api/credentials
// Body: { business_id, section: "wa" | "yoco", ...fields }
// Calls the appropriate partial-update RPC so only the target section is
// re-encrypted — the other integration's secrets are never touched.
export async function POST(req: NextRequest) {
    var encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length < 32) {
        return NextResponse.json({
            error: "SETTINGS_ENCRYPTION_KEY is not configured on the server. Add it to .env.local (must be 32+ characters, matching your Supabase edge-function secret).",
        }, { status: 500 });
    }

    var body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    var { business_id, section, wa_token, wa_phone_id, yoco_secret_key, yoco_webhook_secret } = body;

    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    if (!section) return NextResponse.json({ error: "section is required ('wa' or 'yoco')" }, { status: 400 });

    var supabase = serviceClient();

    if (section === "wa") {
        if (!wa_token?.trim() || !wa_phone_id?.trim()) {
            return NextResponse.json({ error: "Both WhatsApp Access Token and Phone Number ID are required." }, { status: 400 });
        }
        // Key passed as explicit parameter — no session GUC needed
        var { error: waErr } = await supabase.rpc("set_wa_credentials", {
            p_business_id: business_id,
            p_key: encryptionKey,
            p_wa_token: wa_token.trim(),
            p_wa_phone_id: wa_phone_id.trim(),
        });
        if (waErr) {
            return NextResponse.json({ error: "Failed to save WhatsApp credentials: " + waErr.message }, { status: 500 });
        }
    } else if (section === "yoco") {
        if (!yoco_secret_key?.trim() || !yoco_webhook_secret?.trim()) {
            return NextResponse.json({ error: "Both Yoco Secret Key and Webhook Signing Secret are required." }, { status: 400 });
        }
        var { error: yocoErr } = await supabase.rpc("set_yoco_credentials", {
            p_business_id: business_id,
            p_key: encryptionKey,
            p_yoco_secret_key: yoco_secret_key.trim(),
            p_yoco_webhook_secret: yoco_webhook_secret.trim(),
        });
        if (yocoErr) {
            return NextResponse.json({ error: "Failed to save Yoco credentials: " + yocoErr.message }, { status: 500 });
        }
    } else {
        return NextResponse.json({ error: "Invalid section value. Must be 'wa' or 'yoco'." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
}
