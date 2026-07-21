// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantByBusinessId, getAdminAppOrigins, isAllowedOrigin, recordWaMessage, sendWhatsappTemplate, getBusinessDisplayName } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getCors(req?: Request) {
    const origins = getAdminAppOrigins();
    const origin = req?.headers.get("origin") || "";
    const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    };
}

// Item 21: when a WhatsApp reply can't be delivered (24h window closed AND the
// approved template failed, or the number is invalid), automatically fall back
// to email so the customer isn't left with no communication. Resolves an email
// from the conversation, or the most recent booking on that phone. Returns true
// if an email was actually queued.
async function tryEmailFallback(
    supabase: any,
    businessId: string,
    phone: string,
    convoEmail: string | null | undefined,
    customerName: string | null | undefined,
    message: string,
): Promise<boolean> {
    let email = String(convoEmail || "").trim();
    if (!email) {
        try {
            const digits = String(phone || "").replace(/\D/g, "");
            const { data: bk } = await supabase.from("bookings")
                .select("email, customer_name")
                .eq("business_id", businessId)
                .or("phone.eq." + phone + ",phone.eq." + digits)
                .not("email", "is", null)
                .order("created_at", { ascending: false })
                .limit(1).maybeSingle();
            email = String(bk?.email || "").trim();
            if (!customerName) customerName = bk?.customer_name || null;
        } catch (e) { console.error("EMAIL_FALLBACK_LOOKUP_ERR:", e); }
    }
    if (!email) return false;
    try {
        const res = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({
                type: "CUSTOMER_MESSAGE",
                data: { business_id: businessId, email, customer_name: customerName || "there", message },
            }),
        });
        if (!res.ok) { console.error("EMAIL_FALLBACK_SEND_ERR status:" + res.status); return false; }
        const body = await res.json().catch(() => ({}));
        return body?.ok === true;
    } catch (e) {
        console.error("EMAIL_FALLBACK_SEND_ERR:", e);
        return false;
    }
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
        let message = body.message;
        const action = body.action;
        const reqBusinessId = body.business_id || body.businessId || "";

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        if (action === "return_to_bot") {
            if (!reqBusinessId) return new Response(JSON.stringify({ ok: false, error: "business_id is required" }), { status: 400, headers: getCors(req) });
            const { error: rbErr } = await supabase.from("conversations").update({ status: "BOT", current_state: "IDLE", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", reqBusinessId);
            if (rbErr) return new Response(JSON.stringify({ ok: false, error: rbErr.message }), { status: 200, headers: getCors(req) });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });
        }

        // Agent ends a web chat: post a closing message and flag the conversation
        // for a rating prompt (current_state AWAIT_RATING — the widget poll reads
        // this and shows the star picker). handled_by=HUMAN so the rating is
        // attributed to human handling even though status returns to BOT.
        if (action === "end_chat") {
            if (!reqBusinessId) return new Response(JSON.stringify({ ok: false, error: "business_id is required" }), { status: 400, headers: getCors(req) });
            await supabase.from("chat_messages").insert({
                business_id: reqBusinessId, phone: to, direction: "OUT",
                body: message || "Thanks for chatting with us! 🙏 Before you go, please rate how we did.",
                sender: "Admin", sender_type: "ADMIN",
            });
            const { error: ecErr } = await supabase.from("conversations").update({
                status: "BOT", current_state: "AWAIT_RATING", handled_by: "HUMAN", updated_at: new Date().toISOString(),
            }).eq("phone", to).eq("business_id", reqBusinessId);
            if (ecErr) return new Response(JSON.stringify({ ok: false, error: ecErr.message }), { status: 200, headers: getCors(req) });
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
            .select("business_id, customer_name, email, status")
            .eq("phone", to);
        if (reqBusinessId) convoQuery = convoQuery.eq("business_id", reqBusinessId);
        const { data: convo } = await convoQuery.limit(1).single();

        const actualBusinessId = convo?.business_id;
        if (!actualBusinessId) {
            return new Response(JSON.stringify({ ok: false, error: "Conversation is not associated with a business" }), { status: 200, headers: getCors(req) });
        }

        // First human turn: the conversation was bot-handled (or waiting) and an
        // operator is now taking over. Tell the customer a human has joined, once,
        // by prepending to this reply — it then rides every delivery path below
        // (web insert, WA text, template, email fallback) with no extra send.
        if (convo?.status !== "HUMAN") {
            message = "👤 A human has joined the chat.\n\n" + message;
        }

        // Web-chat conversations have no WhatsApp number — their phone is the
        // literal "web" or "web:<visitor-id>". Deliver through the web-chat
        // channel (store the reply; the widget polls for it) instead of Meta,
        // which 400s with "The parameter to is required" on the empty number.
        const isWebChat = /^web(:|$)/.test(String(to));
        if (isWebChat) {
            const { error: webInsErr } = await supabase.from("chat_messages").insert({
                business_id: actualBusinessId, phone: to, direction: "OUT",
                body: message, sender: "Admin", sender_type: "ADMIN",
            });
            if (webInsErr) return new Response(JSON.stringify({ ok: false, error: "Failed to log message", details: webInsErr }), { status: 200, headers: getCors(req) });
            await supabase.from("conversations").update({ status: "HUMAN", handled_by: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", actualBusinessId);
            return new Response(JSON.stringify({ ok: true, channel: "web" }), { status: 200, headers: getCors(req) });
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
            if (errCode === 131047 || errCode === 131026 || errMsg.toLowerCase().includes("24 hour")) {
                const firstName = String(convo?.customer_name || "").split(" ")[0] || "there";

                // Preferred path: send the pre-approved reopener template ("please
                // reply") and queue the actual message in the outbox — wa-webhook
                // drains it the moment the customer replies, which also reopens
                // the 24h window so the admin can chat live from the Inbox.
                const reopenerName = Deno.env.get("WA_REOPENER_TEMPLATE_NAME") || "booking_update_reopener";
                try {
                    await sendWhatsappTemplate(tenant, normalizedTo, reopenerName, [firstName, getBusinessDisplayName(tenant.business)]);
                    await supabase.from("outbox").insert({
                        business_id: actualBusinessId,
                        phone: normalizedTo,
                        message_type: "ADMIN_FOLLOWUP",
                        message_body: message,
                        scheduled_for: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // far future; drained on reply
                        status: "WAITING_WINDOW",
                    });
                    await supabase.from("chat_messages").insert({
                        business_id: actualBusinessId,
                        phone: to,
                        direction: "OUT",
                        body: "⏳ (window closed, sent them a 'please reply' message; this delivers when they respond) " + message,
                        sender: "Admin",
                    });
                    await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", actualBusinessId);
                    return new Response(JSON.stringify({
                        ok: true,
                        via_reopener: true,
                        message: "Their 24-hour WhatsApp window is closed, so we sent a pre-approved message asking them to reply. Your message delivers the moment they do. Then you can chat normally from the Inbox.",
                    }), { status: 200, headers: getCors(req) });
                } catch (reopenErr: any) {
                    // Template missing / not approved for this tenant — fall through
                    // to the legacy admin_outreach → email chain below.
                    console.error("Reopener template failed (" + reopenerName + "):", reopenErr?.message || reopenErr);
                }

                console.log("Outside 24h window — trying admin_outreach template for:", normalizedTo);
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
                await recordWaMessage(actualBusinessId, { to: normalizedTo, kind: "template", templateName: "admin_outreach", body: message, status: templateRes.ok ? "SENT" : "FAILED", providerMessageId: templateData?.messages?.[0]?.id || null, error: templateRes.ok ? null : String(templateData?.error?.message || "admin_outreach template failed") });
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
                // Template also failed — try email so the customer still hears from us.
                console.error("admin_outreach template failed:", templateData);
                const emailedA = await tryEmailFallback(supabase, actualBusinessId, to, convo?.email, convo?.customer_name, message);
                if (emailedA) {
                    await supabase.from("chat_messages").insert({ business_id: actualBusinessId, phone: to, direction: "OUT", body: "📧 (sent by email, WhatsApp window closed) " + message, sender: "Admin" });
                    await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", actualBusinessId);
                    return new Response(JSON.stringify({ ok: true, via_email: true, message: "WhatsApp's 24-hour window is closed, so we sent your reply to the customer by email instead." }), { status: 200, headers: getCors(req) });
                }
                return new Response(JSON.stringify({
                    ok: false,
                    error: "outside_24h_window",
                    message: "WhatsApp only allows you to reply within 24 hours of the customer's last message, and we couldn't reach them by email either (no email on file). Ask them to send you a WhatsApp message first, then you can reply here.",
                }), { status: 200, headers: getCors(req) });
            }

            console.error("WhatsApp Error:", waData);
            await recordWaMessage(actualBusinessId, { to: normalizedTo, kind: "text", body: message, status: "FAILED", error: String(waData?.error?.message || "WhatsApp API Error") });
            // Guaranteed-communication fallback: try email regardless of the WA error cause.
            const emailedB = await tryEmailFallback(supabase, actualBusinessId, to, convo?.email, convo?.customer_name, message);
            if (emailedB) {
                await supabase.from("chat_messages").insert({ business_id: actualBusinessId, phone: to, direction: "OUT", body: "📧 (sent by email, WhatsApp failed) " + message, sender: "Admin" });
                await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("phone", to).eq("business_id", actualBusinessId);
                return new Response(JSON.stringify({ ok: true, via_email: true, message: "WhatsApp couldn't deliver this, so we sent your reply to the customer by email instead." }), { status: 200, headers: getCors(req) });
            }
            // OAuth 190 = invalid/expired access token — tell the admin exactly what to do
            if (waData?.error?.code === 190) {
                return new Response(JSON.stringify({
                    ok: false,
                    error: "WhatsApp access token expired",
                    message: "Your WhatsApp access token is invalid or has expired. Generate a new token in Meta (WhatsApp → API Setup) and re-save it in Settings → Integration Credentials. " + String(waData?.error?.message || ""),
                    details: waData,
                }), { status: 200, headers: getCors(req) });
            }
            return new Response(JSON.stringify({ ok: false, error: "WhatsApp API Error", details: waData }), { status: 200, headers: getCors(req) });
        }

        await recordWaMessage(actualBusinessId, { to: normalizedTo, kind: "text", body: message, status: "SENT", providerMessageId: waData?.messages?.[0]?.id || null });

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
