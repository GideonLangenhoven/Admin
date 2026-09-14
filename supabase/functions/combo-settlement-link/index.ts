// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X)
// or an equivalent tenant filter derived from the authenticated session.
//
// POST /functions/v1/combo-settlement-link
//
// Operator B (the owed party in the Yoco manual-settlement combo model) calls
// this to generate a Yoco payment link for everything partner A currently owes
// them. The checkout is created on B's OWN Yoco account, so A's payment lands
// directly with B. A PENDING_PAYMENT row is written to combo_settlements
// (visible in Reports → Settlement Register) and the link is emailed to
// operator A. yoco-webhook flips the row to PAID and settles the underlying
// combo bookings when the payment succeeds.
//
// Requires: Authorization: Bearer <admin_access_token>, MAIN_ADMIN/SUPER_ADMIN.
// Body: { partner_business_id: uuid }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  getTenantByBusinessId,
  getBusinessDisplayName,
  getAdminAppOrigins,
  isAllowedOrigin,
} from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

// Mirrors app/lib/hidden-superadmin-emails.ts — the platform superadmin's
// backup logins must never receive operator-facing settlement emails.
const HIDDEN_SUPERADMIN_EMAILS = ["gidslang89@gmail.com", "info@capeweb.co.za"];

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

async function verifyAdminSession(req: any) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data: userRes, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userRes?.user) return null;
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, business_id, role, suspended")
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (!admin || admin.suspended) return null;
    return {
      user_id: userRes.user.id as string,
      admin_id: admin.id as string,
      business_id: admin.business_id as string,
      role: admin.role as string,
    };
  } catch {
    return null;
  }
}

function fail(req: any, message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: getCors(req) });
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    const body = await req.json().catch(() => ({}));
    const partnerBusinessId = String(body.partner_business_id || "");
    if (!partnerBusinessId) return fail(req, "partner_business_id required", 400);

    const session = await verifyAdminSession(req);
    if (!session) return fail(req, "Admin session required", 401);
    if (!/MAIN_ADMIN|SUPER_ADMIN/i.test(session.role || "")) {
      return fail(req, "MAIN_ADMIN required", 403);
    }
    const myBizId = session.business_id;
    if (partnerBusinessId === myBizId) return fail(req, "Cannot settle with yourself", 400);

    // Everything partner A has collected and not yet settled with me.
    // N-party via combo_booking_items (my unsettled legs on combos the partner
    // collected); legacy 2-party via the offer's A/B columns.
    const combosRes = await supabase
      .from("combo_bookings")
      .select("id, combo_total, split_b_amount, created_at, combo_booking_items(business_id, split_amount, settled_at, position), combo_offers(partnership_id, business_a_id, business_b_id, created_by_business_id)")
      .eq("settled", false)
      .in("payment_status", ["PAID", "VOUCHER_ISSUED"]);
    if (combosRes.error) return fail(req, combosRes.error.message, 500);

    const combos: any[] = [];
    let amountOwed = 0;
    for (const c of (combosRes.data || []) as any[]) {
      const cOffer = c.combo_offers;
      if (!cOffer) continue;
      const items = c.combo_booking_items || [];
      if (items.length > 0) {
        const collector = cOffer.business_a_id || cOffer.created_by_business_id
          || items.find((it: any) => it.position === 1)?.business_id;
        if (String(collector) !== partnerBusinessId) continue;
        const owed = items
          .filter((it: any) => it.business_id === myBizId && !it.settled_at)
          .reduce((s: number, it: any) => s + Number(it.split_amount || 0), 0);
        if (owed <= 0) continue;
        combos.push(c);
        amountOwed += owed;
      } else {
        if (cOffer.business_a_id !== partnerBusinessId || cOffer.business_b_id !== myBizId) continue;
        const owed = Number(c.split_b_amount || 0);
        if (owed <= 0) continue;
        combos.push(c);
        amountOwed += owed;
      }
    }
    amountOwed = Math.round(amountOwed * 100) / 100;
    if (combos.length === 0 || amountOwed <= 0) {
      return fail(req, "Nothing is currently owed to you by this partner.", 400);
    }

    // Reuse an open link if it still matches the current total; otherwise
    // supersede stale open requests so only one live link exists per pair.
    const openRes = await supabase
      .from("combo_settlements")
      .select("id, amount_owed, payment_url")
      .eq("owed_business_id", myBizId)
      .eq("collector_business_id", partnerBusinessId)
      .eq("status", "PENDING_PAYMENT");
    const openRows = openRes.data || [];
    const reusable = openRows.find((r: any) => Number(r.amount_owed) === amountOwed && r.payment_url);
    if (reusable) {
      return new Response(JSON.stringify({
        ok: true, reused: true, settlement_id: reusable.id,
        payment_url: reusable.payment_url, amount: amountOwed, combo_count: combos.length,
      }), { status: 200, headers: getCors(req) });
    }
    if (openRows.length > 0) {
      await supabase.from("combo_settlements").update({ status: "SUPERSEDED" })
        .in("id", openRows.map((r: any) => r.id));
    }

    const myTenant = await getTenantByBusinessId(supabase, myBizId);
    if (!myTenant.credentials.activeYocoSecretKey) {
      return fail(req, "No Yoco secret key configured for your business. Add it under Settings → Integration Credentials first — the payment must land in your own Yoco account.", 503);
    }
    const partnerTenant = await getTenantByBusinessId(supabase, partnerBusinessId);
    const myBrand = getBusinessDisplayName(myTenant.business);
    const partnerBrand = getBusinessDisplayName(partnerTenant.business);
    // subdomain / notification_email are not part of the shared tenant select
    const { data: partnerBizRow } = await supabase
      .from("businesses")
      .select("subdomain, notification_email")
      .eq("id", partnerBusinessId)
      .maybeSingle();

    const dates = combos.map((c: any) => String(c.created_at).slice(0, 10)).sort();
    const nowIso = new Date().toISOString();

    // N-party offers store no pairwise partnership on the offer row — resolve
    // the canonical (collector, me) pair from business_partnerships.
    let partnershipId = (combos[0] as any).combo_offers?.partnership_id || null;
    if (!partnershipId) {
      const aId = myBizId < partnerBusinessId ? myBizId : partnerBusinessId;
      const bId = myBizId < partnerBusinessId ? partnerBusinessId : myBizId;
      const { data: pRow } = await supabase.from("business_partnerships").select("id")
        .eq("business_a_id", aId).eq("business_b_id", bId).maybeSingle();
      partnershipId = pRow?.id || null;
    }
    if (!partnershipId) return fail(req, "No partnership found with this operator.", 400);

    const insertRes = await supabase.from("combo_settlements").insert({
      partnership_id: partnershipId,
      period_start: dates[0],
      period_end: dates[dates.length - 1],
      collector_business_id: partnerBusinessId,
      owed_business_id: myBizId,
      total_collected: Math.round(combos.reduce((s: number, c: any) => s + Number(c.combo_total || 0), 0) * 100) / 100,
      amount_owed: amountOwed,
      combo_booking_count: combos.length,
      status: "PENDING_PAYMENT",
      combo_booking_ids: combos.map((c: any) => c.id),
      requested_by: session.admin_id,
      notes: "Payment link requested by " + myBrand,
    }).select("id").single();
    if (insertRes.error || !insertRes.data) {
      return fail(req, "Could not record settlement request: " + (insertRes.error?.message || "unknown"), 500);
    }
    const settlementId = insertRes.data.id as string;

    // Create the Yoco checkout on B's account. Success/cancel land partner A
    // back on their own Partners page (their admin subdomain — the bare admin
    // domain is not routable).
    const partnerAdmin = "https://" + (partnerBizRow?.subdomain || "admin") + ".admin.bookingtours.co.za";
    const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: "Bearer " + myTenant.credentials.activeYocoSecretKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(amountOwed * 100),
        currency: myTenant.business.currency || "ZAR",
        successUrl: partnerAdmin + "/partnerships?settlement_paid=1",
        cancelUrl: partnerAdmin + "/partnerships",
        failureUrl: partnerAdmin + "/partnerships",
        metadata: {
          type: "COMBO_SETTLEMENT",
          settlement_id: settlementId,
          business_id: myBizId,
        },
      }),
    });
    const yocoData = await yocoRes.json().catch(() => ({}));
    if (!yocoRes.ok || !yocoData?.id || !yocoData?.redirectUrl) {
      await supabase.from("combo_settlements").update({ status: "FAILED", notes: "Yoco checkout creation failed" }).eq("id", settlementId);
      return fail(req, "Yoco checkout failed: " + (yocoData?.message || yocoData?.error?.message || "unknown"), 502);
    }

    await supabase.from("combo_settlements").update({
      yoco_checkout_id: yocoData.id,
      payment_url: yocoData.redirectUrl,
    }).eq("id", settlementId);

    // Email operator A the payment request. notification_email first, else
    // their visible MAIN_ADMIN seat.
    let partnerEmail = String(partnerBizRow?.notification_email || "").trim();
    if (!partnerEmail) {
      const { data: partnerAdmins } = await supabase
        .from("admin_users")
        .select("email")
        .eq("business_id", partnerBusinessId)
        .eq("role", "MAIN_ADMIN")
        .eq("suspended", false);
      partnerEmail = (partnerAdmins || []).map((a: any) => String(a.email || ""))
        .find((e: string) => e && !HIDDEN_SUPERADMIN_EMAILS.includes(e.toLowerCase())) || "";
    }
    let emailSent = false;
    if (partnerEmail) {
      try {
        const emailRes = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({
            type: "SETTLEMENT_REQUEST",
            data: {
              email: partnerEmail,
              business_id: myBizId,
              requester_name: myBrand,
              partner_name: partnerBrand,
              amount: amountOwed.toFixed(2),
              combo_count: combos.length,
              period_label: dates[0] + " to " + dates[dates.length - 1],
              payment_url: yocoData.redirectUrl,
            },
          }),
        });
        emailSent = emailRes.ok;
        if (!emailRes.ok) console.error("SETTLEMENT_REQUEST email failed:", emailRes.status, await emailRes.text());
      } catch (e) {
        console.error("SETTLEMENT_REQUEST email error:", e);
      }
    }

    await supabase.from("logs").insert({
      business_id: myBizId,
      event: "combo_settlement_link_created",
      payload: {
        settlement_id: settlementId,
        partner_business_id: partnerBusinessId,
        amount_owed: amountOwed,
        combo_count: combos.length,
        yoco_checkout_id: yocoData.id,
        email_sent: emailSent,
        email_to: partnerEmail || null,
        requested_at: nowIso,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      settlement_id: settlementId,
      payment_url: yocoData.redirectUrl,
      amount: amountOwed,
      combo_count: combos.length,
      email_sent: emailSent,
      email_to: partnerEmail || null,
    }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("COMBO_SETTLEMENT_LINK_ERROR:", err);
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), { status: 500, headers: getCors(null) });
  }
});
