import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantByBusinessId } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGINS = [
    "https://admin.capekayak.co.za",
    "https://book.capekayak.co.za",
    "https://capekayak.co.za",
    "https://caepweb-admin.vercel.app",
    "https://bookingtours.co.za",
    "https://www.bookingtours.co.za",
    "http://localhost:3000",
    "http://localhost:3001"
];

function getCors(req?: Request) {
    const origin = req?.headers.get("origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    };
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: getCors(req) });
    }

    try {
        const bodyText = await req.text();
        let body;
        try {
            body = JSON.parse(bodyText);
        } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: getCors(req) });
        }

        const to = body.phone;
        const message = body.message;
        const action = body.action;

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        if (action === "return_to_bot") {
            const { error: rbErr } = await supabase.from("conversations").update({ status: "BOT", current_state: "IDLE", updated_at: new Date().toISOString() }).eq("phone", to);
            // We return 200 with ok: false so frontend can read the JSON error instead of hitting a generic 500
            if (rbErr) return new Response(JSON.stringify({ ok: false, error: rbErr.message }), { status: 200, headers: getCors(req) });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });
        }

        if (!to || !message) {
            return new Response(JSON.stringify({ ok: false, error: "Missing phone or message" }), { status: 200, headers: getCors(req) });
        }

        // Get conversation to ensure correct business ID and state
        const { data: convo } = await supabase
            .from("conversations")
            .select("business_id, customer_name")
            .eq("phone", to)
            .limit(1)
            .single();

        const actualBusinessId = convo?.business_id;
        if (!actualBusinessId) {
            return new Response(JSON.stringify({ ok: false, error: "Conversation is not associated with a business" }), { status: 200, headers: getCors(req) });
        }
        const tenant = await getTenantByBusinessId(supabase, actualBusinessId);

        // Send WhatsApp Message
        let waRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
            method: "POST",
            headers: {
                Authorization: "Bearer " + tenant.credentials.waToken,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: { body: message }
            }),
        });

        // If we get an error about outside the 24 hour window (code 131047 or similar), 
        // fallback to sending a generic template message.
        if (!waRes.ok) {
            const waDataCheck = await waRes.clone().json();
            if (waDataCheck.error && (waDataCheck.error.code === 131047 || waDataCheck.error.message.includes("24"))) {
                console.log("Outside 24h window. Sending template fallback from admin-reply...");
                waRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
                    method: "POST",
                    headers: {
                        Authorization: "Bearer " + tenant.credentials.waToken,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: to,
                        type: "template",
                        template: {
                            name: "hello_world", // Replace with approved template
                            language: { code: "en_US" }
                        }
                    }),
                });
            }
        }

        const waData = await waRes.json();

        if (!waRes.ok) {
            console.error("WhatsApp Error:", waData);
            // Return 200 with error details so the frontend can read the JSON, rather than an opaque 500
            return new Response(JSON.stringify({ ok: false, error: "WhatsApp API Error", details: waData }), { status: 200, headers: getCors(req) });
        }

        // Insert into chat_messages
        const { error: insertErr } = await supabase.from("chat_messages").insert({
            business_id: actualBusinessId,
            phone: to,
            direction: "OUT",
            body: message,
            sender: "Admin"
        });

        if (insertErr) {
            console.error("Insert Error:", insertErr);
            return new Response(JSON.stringify({ ok: false, error: "Failed to log message", details: insertErr }), { status: 200, headers: getCors(req) });
        }

        // Ensure conversation status stays as HUMAN so bot doesn't reply to their next message automatically
        await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to);

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });

    } catch (err: unknown) {
        console.error("admin-reply edge function error:", err);
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 200, headers: getCors(req) });
    }
});
