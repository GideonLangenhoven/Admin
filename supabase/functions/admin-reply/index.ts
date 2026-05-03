// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantByBusinessId, getAdminAppOrigins } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getCors(req?: Request) {
    const origins = getAdminAppOrigins();
    const origin = req?.headers.get("origin") || "";
    const allowed = origins.includes(origin) ? origin : origins[0];
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
        console.log("admin-reply raw body:", bodyText);
        let body;
        try {
            body = JSON.parse(bodyText);
        } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON", raw: bodyText }), { status: 400, headers: getCors(req) });
        }

        const to = body.phone || body.to || body.to_phone;
        const message = body.message;
        const action = body.action;
        const reqBusinessId = body.business_id || body.businessId || "";

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        if (action === "return_to_bot") {
            if (!reqBusinessId) return new Response(JSON.stringify({ ok: false, error: "business_id is required" }), { status: 400, headers: getCors(req) });
            const { error: rbErr } = await supabase.from("conversations").update({ status: "BOT", current_state: "IDLE", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", reqBusinessId);
            if (rbErr) return new Response(JSON.stringify({ ok: false, error: rbErr.message }), { status: 200, headers: getCors(req) });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });
        }

        if (!to || !message) {
            return new Response(JSON.stringify({
                ok: false,
                error: `Missing phone (${to}) or message (${message?.length}). Received keys: ${Object.keys(body).join(", ")}`,
                debug: { body }
            }), { status: 200, headers: getCors(req) });
        }

        // Get conversation to ensure correct business ID and state
        let convoQuery = supabase
            .from("conversations")
            .select("business_id, customer_name")
            .eq("phone", to);
        if (reqBusinessId) convoQuery = convoQuery.eq("business_id", reqBusinessId);
        const { data: convo } = await convoQuery.limit(1).single();

        const actualBusinessId = convo?.business_id;
        if (!actualBusinessId) {
            return new Response(JSON.stringify({ ok: false, error: "Conversation is not associated with a business" }), { status: 200, headers: getCors(req) });
        }
        const tenant = await getTenantByBusinessId(supabase, actualBusinessId);

        // Guard: return a structured error instead of a malformed WA API call
        if (!tenant.credentials.waToken || !tenant.credentials.waPhoneId) {
            return new Response(JSON.stringify({
                ok: false,
                error: "whatsapp_not_configured",
                message: "WhatsApp credentials are not set for this business. Go to Admin → Settings → Integration Credentials to add them.",
            }), { status: 200, headers: getCors(req) });
        }

        // Normalize phone — strip non-digits, convert local 0xx to 27xx
        const normalizedTo = to.replace(/\D/g, "").replace(/^0/, "27");

        // Send WhatsApp Message
        const waRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
            method: "POST",
            headers: {
                Authorization: "Bearer " + tenant.credentials.waToken,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: normalizedTo,
                type: "text",
                text: { body: message }
            }),
        });

        const waData = await waRes.json();

        if (!waRes.ok) {
            const errCode = waData?.error?.code;
            const errMsg = waData?.error?.message || "";

            // 131047 = outside 24h customer service window
            // 131026 = recipient hasn't messaged this number before
            // Fall back to the approved admin_outreach template so the message still reaches the customer.
            if (errCode === 131047 || errCode === 131026 || errMsg.toLowerCase().includes("24 hour")) {
                console.log("Outside 24h window — trying admin_outreach template for:", normalizedTo);
                const firstName = String(convo?.customer_name || "").split(" ")[0] || "there";
                const templateRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
                    method: "POST",
                    headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: normalizedTo,
                        type: "template",
                        template: {
                            name: "admin_outreach",
                            language: { code: "en" },
                            components: [{
                                type: "body",
                                parameters: [
                                    { type: "text", text: firstName },
                                    { type: "text", text: message },
                                ],
                            }],
                        },
                    }),
                });
                const templateData = await templateRes.json().catch(() => ({}));
                if (templateRes.ok) {
                    // Log the message so it appears in the chat thread
                    await supabase.from("chat_messages").insert({
                        business_id: actualBusinessId,
                        phone: to,
                        direction: "OUT",
                        body: message,
                        sender: "Admin",
                    });
                    await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", actualBusinessId);
                    return new Response(JSON.stringify({ ok: true, via_template: true }), { status: 200, headers: getCors(req) });
                }
                // Template also failed — let admin know
                console.error("admin_outreach template failed:", templateData);
                return new Response(JSON.stringify({
                    ok: false,
                    error: "outside_24h_window",
                    message: "WhatsApp only allows you to reply within 24 hours of the customer's last message. This customer hasn't messaged your WhatsApp number yet (or their last message was more than 24 hours ago). Ask them to send you a WhatsApp message first, then you can reply here.",
                }), { status: 200, headers: getCors(req) });
            }

            console.error("WhatsApp Error:", waData);
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
        await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", actualBusinessId);

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });

    } catch (err: unknown) {
        console.error("admin-reply edge function error:", err);
        return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 200, headers: getCors(req) });
    }
});
