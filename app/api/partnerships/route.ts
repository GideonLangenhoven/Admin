import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// ── Partnership invite-token rate limiter ────────────────────────────────────
// In-memory per-token attempt counter. 5 failed attempts per 60-minute window,
// then 429 until the window rolls over. Per-instance; acceptable for invite
// endpoints which see low total traffic.
const tokenAttempts = new Map<string, { count: number; firstAt: number }>();
const TOKEN_MAX_ATTEMPTS = 5;
const TOKEN_RATE_WINDOW_MS = 60 * 60 * 1000;

// GET /api/partnerships?business_id=xxx
export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const businessId = req.nextUrl.searchParams.get("business_id");
  if (!businessId) return NextResponse.json({ error: "business_id query param is required" }, { status: 400 });

  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
    return NextResponse.json({ error: "You can only view partnerships for your own business" }, { status: 403 });
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("business_partnerships")
    .select("*, business_a:businesses!business_partnerships_business_a_id_fkey(id, name, business_name), business_b:businesses!business_partnerships_business_b_id_fkey(id, name, business_name)")
    .or(`business_a_id.eq.${businessId},business_b_id.eq.${businessId}`)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const partnerships = (data || []).map((p: any) => {
    const isA = p.business_a_id === businessId;
    const partner = isA ? p.business_b : p.business_a;
    return {
      ...p,
      partner_id: isA ? p.business_b_id : p.business_a_id,
      partner_name: partner?.business_name || partner?.name || "Unknown",
    };
  });

  return NextResponse.json({ partnerships });
}

// POST /api/partnerships
// Actions: invite, accept, accept_token, revoke
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { business_id, action } = body;
  const supabase = serviceClient();

  // accept_token is token-gated (no session required — email link flow)
  if (action !== "accept_token") {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) {
      return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
    }
    if (business_id && caller.role !== "SUPER_ADMIN" && caller.business_id !== business_id) {
      return NextResponse.json({ error: "You can only manage partnerships for your own business" }, { status: 403 });
    }
  }

  // --- INVITE ---
  if (action === "invite") {
    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    const { partner_email } = body;
    if (!partner_email?.trim()) return NextResponse.json({ error: "partner_email is required" }, { status: 400 });

    const normalizedEmail = partner_email.trim().toLowerCase();

    // Look up partner business by admin email
    const { data: adminUser, error: adminErr } = await supabase
      .from("admin_users")
      .select("business_id, email, name")
      .eq("email", normalizedEmail)
      .in("role", ["MAIN_ADMIN", "SUPER_ADMIN"])
      .maybeSingle();

    if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });
    if (!adminUser?.business_id) return NextResponse.json({ error: "No business found for that admin email." }, { status: 404 });

    const partnerId = adminUser.business_id;
    if (partnerId === business_id) return NextResponse.json({ error: "Cannot partner with yourself." }, { status: 400 });

    // Check for existing active/pending partnership
    const { data: existing } = await supabase
      .from("business_partnerships")
      .select("id, status")
      .or(`and(business_a_id.eq.${business_id},business_b_id.eq.${partnerId}),and(business_a_id.eq.${partnerId},business_b_id.eq.${business_id})`)
      .in("status", ["PENDING", "ACTIVE"])
      .maybeSingle();

    if (existing) return NextResponse.json({ error: "A partnership already exists (status: " + existing.status + ")." }, { status: 409 });

    // Canonical ordering
    const aId = business_id < partnerId ? business_id : partnerId;
    const bId = business_id < partnerId ? partnerId : business_id;

    // Generate invite token
    const inviteToken = crypto.randomBytes(32).toString("hex");

    const { data: created, error: createErr } = await supabase
      .from("business_partnerships")
      .insert({
        business_a_id: aId,
        business_b_id: bId,
        status: "PENDING",
        initiated_by: business_id,
        invite_token: inviteToken,
        invite_email: normalizedEmail,
        invite_sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

    // Load inviting business name for the email
    const { data: inviterBiz } = await supabase
      .from("businesses")
      .select("business_name, name")
      .eq("id", business_id)
      .single();
    const inviterName = inviterBiz?.business_name || inviterBiz?.name || "A BookingTours operator";

    // Send partnership invite email via send-email function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const adminAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://admin.bookingtours.co.za";
    const approveUrl = adminAppUrl + "/api/partnerships/approve?token=" + inviteToken;

    try {
      await fetch(supabaseUrl + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
        body: JSON.stringify({
          type: "PARTNERSHIP_INVITE",
          data: {
            email: normalizedEmail,
            inviter_name: inviterName,
            approve_url: approveUrl,
            partner_name: adminUser.name || normalizedEmail,
          },
        }),
      });
    } catch (e) {
      console.error("Partnership invite email error:", e);
    }

    return NextResponse.json({ partnership: created });
  }

  // --- ACCEPT (from dashboard, requires business_id) ---
  if (action === "accept") {
    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    const { partnership_id } = body;
    if (!partnership_id) return NextResponse.json({ error: "partnership_id is required" }, { status: 400 });

    const { data: updated, error: acceptErr } = await supabase
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

  // --- ACCEPT VIA EMAIL TOKEN ---
  // Hardened: single-use token (cleared on successful accept), rate-limited
  // per-token, requires caller to echo invite_email as proof-of-receipt.
  if (action === "accept_token") {
    const { token } = body;
    const inviteEmailFromCaller = String((body as any).invite_email || "").trim().toLowerCase();
    if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
    if (!inviteEmailFromCaller) {
      return NextResponse.json({ error: "invite_email is required (the email address the invite was sent to)" }, { status: 400 });
    }

    // Rate-limit: 5 failed attempts per-token per hour.
    if (!tokenAttempts.has(token)) tokenAttempts.set(token, { count: 0, firstAt: Date.now() });
    const attempt = tokenAttempts.get(token)!;
    if (Date.now() - attempt.firstAt > TOKEN_RATE_WINDOW_MS) {
      attempt.count = 0; attempt.firstAt = Date.now();
    }
    if (attempt.count >= TOKEN_MAX_ATTEMPTS) {
      return NextResponse.json({ error: "Too many attempts. Please request a new invite." }, { status: 429 });
    }

    // Look up pending partnership by token — do NOT update yet (need to check email match first)
    const { data: pending, error: lookupErr } = await supabase
      .from("business_partnerships")
      .select("id, business_a_id, business_b_id, invite_email, status")
      .eq("invite_token", token)
      .eq("status", "PENDING")
      .maybeSingle();

    if (lookupErr) {
      attempt.count += 1;
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (!pending) {
      attempt.count += 1;
      return NextResponse.json({ error: "Invalid or expired invite token." }, { status: 404 });
    }

    const expectedEmail = String(pending.invite_email || "").trim().toLowerCase();
    if (expectedEmail && expectedEmail !== inviteEmailFromCaller) {
      attempt.count += 1;
      return NextResponse.json({ error: "Email does not match the invitation." }, { status: 403 });
    }

    // Accept atomically AND clear invite_token so it can't be replayed.
    const { data: tokenPartnership, error: tokenErr } = await supabase
      .from("business_partnerships")
      .update({
        status: "ACTIVE",
        accepted_at: new Date().toISOString(),
        invite_token: null,
      })
      .eq("id", pending.id)
      .eq("status", "PENDING")  // concurrency guard
      .select()
      .single();

    if (tokenErr) return NextResponse.json({ error: tokenErr.message }, { status: 500 });
    if (!tokenPartnership) {
      return NextResponse.json({ error: "Invite was already accepted or has expired." }, { status: 409 });
    }

    tokenAttempts.delete(token);  // success → drop the counter
    return NextResponse.json({ partnership: tokenPartnership });
  }

  // --- REVOKE ---
  if (action === "revoke") {
    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    const { partnership_id } = body;
    if (!partnership_id) return NextResponse.json({ error: "partnership_id is required" }, { status: 400 });

    const { data: revoked, error: revokeErr } = await supabase
      .from("business_partnerships")
      .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
      .eq("id", partnership_id)
      .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
      .select()
      .single();

    if (revokeErr) return NextResponse.json({ error: revokeErr.message }, { status: 500 });
    if (!revoked) return NextResponse.json({ error: "Partnership not found." }, { status: 404 });

    // Deactivate all combo offers under this partnership
    await supabase.from("combo_offers").update({ active: false }).eq("partnership_id", partnership_id);

    return NextResponse.json({ partnership: revoked });
  }

  return NextResponse.json({ error: "Invalid action. Must be 'invite', 'accept', 'accept_token', or 'revoke'." }, { status: 400 });
}
