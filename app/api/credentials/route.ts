import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";

function serviceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    let key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey && serviceKey.length > 40 && !serviceKey.includes("your-")) {
        key = serviceKey;
    }
    return createClient(url, key);
}

export async function GET(req: NextRequest) {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) {
        return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
    }

    const businessId = req.nextUrl.searchParams.get("business_id");
    if (!businessId) {
        return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });
    }

    if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
        return NextResponse.json({ error: "You can only view credentials for your own business" }, { status: 403 });
    }

    const supabase = serviceClient();
    const { data, error } = await supabase
        .from("businesses")
        .select("wa_token_encrypted, wa_phone_id_encrypted, yoco_secret_key_encrypted, yoco_webhook_secret_encrypted, yoco_test_mode, yoco_test_secret_key_encrypted, yoco_test_webhook_secret_encrypted")
        .eq("id", businessId)
        .maybeSingle();
    if (error) {
        console.error("CREDENTIALS_GET_ERR:", error.message, error.code, error.details);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Business not found" }, { status: 404 });
    return NextResponse.json({
        wa: !!data.wa_token_encrypted && !!data.wa_phone_id_encrypted,
        yoco: !!data.yoco_secret_key_encrypted && !!data.yoco_webhook_secret_encrypted,
        yoco_test_mode: data.yoco_test_mode === true,
        yoco_test: !!data.yoco_test_secret_key_encrypted && !!data.yoco_test_webhook_secret_encrypted,
    });
}

export async function POST(req: NextRequest) {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) {
        return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
    }

    const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length < 32) {
        return NextResponse.json({
            error: "SETTINGS_ENCRYPTION_KEY is not configured on the server.",
        }, { status: 500 });
    }
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const { business_id, section, wa_token, wa_phone_id, yoco_secret_key, yoco_webhook_secret, yoco_test_secret_key, yoco_test_webhook_secret, yoco_test_mode } = body;
    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    if (!section) return NextResponse.json({ error: "section is required ('wa', 'yoco', or 'yoco_test')" }, { status: 400 });

    if (caller.role !== "SUPER_ADMIN" && caller.business_id !== business_id) {
        return NextResponse.json({ error: "You can only update credentials for your own business" }, { status: 403 });
    }

    const supabase = serviceClient();
    if (section === "wa") {
        if (!wa_token?.trim() || !wa_phone_id?.trim()) {
            return NextResponse.json({ error: "Both WhatsApp Access Token and Phone Number ID are required." }, { status: 400 });
        }
        const { error: waErr } = await supabase.rpc("set_wa_credentials", {
            p_business_id: business_id, p_key: encryptionKey, p_wa_token: wa_token.trim(), p_wa_phone_id: wa_phone_id.trim(),
        });
        if (waErr) return NextResponse.json({ error: "Failed to save WhatsApp credentials: " + waErr.message }, { status: 500 });
    } else if (section === "yoco") {
        if (!yoco_secret_key?.trim() || !yoco_webhook_secret?.trim()) {
            return NextResponse.json({ error: "Both Yoco Secret Key and Webhook Signing Secret are required." }, { status: 400 });
        }
        const { error: yocoErr } = await supabase.rpc("set_yoco_credentials", {
            p_business_id: business_id, p_key: encryptionKey, p_yoco_secret_key: yoco_secret_key.trim(), p_yoco_webhook_secret: yoco_webhook_secret.trim(),
        });
        if (yocoErr) return NextResponse.json({ error: "Failed to save Yoco credentials: " + yocoErr.message }, { status: 500 });
    } else if (section === "yoco_test") {
        if (!yoco_test_secret_key?.trim() || !yoco_test_webhook_secret?.trim()) {
            return NextResponse.json({ error: "Both Yoco Test Secret Key and Test Webhook Signing Secret are required." }, { status: 400 });
        }
        const { error: testErr } = await supabase.rpc("set_yoco_test_credentials", {
            p_business_id: business_id, p_key: encryptionKey, p_yoco_test_secret_key: yoco_test_secret_key.trim(), p_yoco_test_webhook_secret: yoco_test_webhook_secret.trim(),
        });
        if (testErr) return NextResponse.json({ error: "Failed to save Yoco test credentials: " + testErr.message }, { status: 500 });
    } else if (section === "yoco_test_mode") {
        const { error: modeErr } = await supabase
            .from("businesses")
            .update({ yoco_test_mode: yoco_test_mode === true })
            .eq("id", business_id);
        if (modeErr) return NextResponse.json({ error: "Failed to update test mode: " + modeErr.message }, { status: 500 });
    } else {
        return NextResponse.json({ error: "Invalid section value." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
