import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";

const PUBLIC_COLUMNS = "id,business_a_id,business_b_id,status,initiated_by,accepted_at,revoked_at,created_at,invite_sent_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });

  const businessId = req.nextUrl.searchParams.get("business_id");
  if (!businessId || !UUID.test(businessId)) return NextResponse.json({ error: "A valid business_id is required" }, { status: 400 });

  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
    return NextResponse.json({ error: "You can only view partnerships for your own business" }, { status: 403 });
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("business_partnerships")
    .select(PUBLIC_COLUMNS + ", business_a:businesses!business_partnerships_business_a_id_fkey(id, name, business_name), business_b:businesses!business_partnerships_business_b_id_fkey(id, name, business_name)")
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { business_id, action } = body;
  if (action !== "accept_token" && (typeof business_id !== "string" || !UUID.test(business_id))) {
    return NextResponse.json({ error: "A valid business_id is required" }, { status: 400 });
  }
  if (["accept", "revoke"].includes(action) && (typeof body.partnership_id !== "string" || !UUID.test(body.partnership_id))) {
    return NextResponse.json({ error: "A valid partnership_id is required" }, { status: 400 });
  }
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
    if (typeof partner_email !== "string" || !partner_email.trim()) return NextResponse.json({ error: "partner_email is required" }, { status: 400 });

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

    const aId = business_id < partnerId ? business_id : partnerId;
    const bId = business_id < partnerId ? partnerId : business_id;
    const { data: existing, error: existingErr } = await supabase
      .from("business_partnerships")
      .select("id, status")
      .eq("business_a_id", aId)
      .eq("business_b_id", bId)
      .maybeSingle();

    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    if (existing && existing.status !== "REVOKED") return NextResponse.json({ error: "A partnership already exists (status: " + existing.status + ")." }, { status: 409 });

    // Generate invite token
    const inviteToken = randomBytes(32).toString("hex");

    const invitation = {
        business_a_id: aId,
        business_b_id: bId,
        status: "PENDING",
        initiated_by: business_id,
        invite_token: inviteToken,
        invite_email: normalizedEmail,
        invite_sent_at: new Date().toISOString(),
        accepted_at: null,
        revoked_at: null,
    };
    // Reuse the unique pair, preserving historical offer/settlement references.
    const write = existing
      ? supabase.from("business_partnerships").update(invitation).eq("id", existing.id).eq("status", "REVOKED")
      : supabase.from("business_partnerships").insert(invitation);
    const { data: created, error: createErr } = await write.select(PUBLIC_COLUMNS).maybeSingle();

    if (createErr) return NextResponse.json({ error: createErr.code === "23505" ? "A partnership invitation already exists." : createErr.message }, { status: createErr.code === "23505" ? 409 : 500 });
    if (!created) return NextResponse.json({ error: "The partnership changed. Refresh and try again." }, { status: 409 });

    // Load inviting business name for the email
    const { data: inviterBiz } = await supabase
      .from("businesses")
      .select("business_name, name")
      .eq("id", business_id)
      .single();
    const inviterName = inviterBiz?.business_name || inviterBiz?.name || "A BookingTours operator";

    // Send partnership invite email via send-email function.
    // The approve link must live on the partner's own admin subdomain — only
    // the *.admin wildcard is attached to the Vercel project; the bare admin
    // domain 404s.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const { data: partnerBiz } = await supabase
      .from("businesses")
      .select("subdomain")
      .eq("id", partnerId)
      .single();
    const adminAppUrl = partnerBiz?.subdomain
      ? "https://" + partnerBiz.subdomain + ".admin.bookingtours.co.za"
      : (process.env.NEXT_PUBLIC_APP_URL || "https://admin.bookingtours.co.za");
    const approveUrl = adminAppUrl + "/api/partnerships/approve?token=" + inviteToken;

    let emailSent = false;
    try {
      const emailRes = await fetch(supabaseUrl + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
        body: JSON.stringify({
          type: "PARTNERSHIP_INVITE",
          data: {
            email: normalizedEmail,
            business_id,
            inviter_name: inviterName,
            approve_url: approveUrl,
            partner_name: adminUser.name || normalizedEmail,
          },
        }),
      });
      if (!emailRes.ok) {
        console.error("Partnership invite email failed:", emailRes.status);
      } else {
        const result = await emailRes.json().catch(() => null);
        emailSent = result?.ok === true;
      }
    } catch (e) {
      console.error("Partnership invite email error:", e);
    }

    return NextResponse.json({ partnership: created, email_sent: emailSent });
  }

  // --- ACCEPT (from dashboard, requires business_id) ---
  if (action === "accept") {
    if (!business_id) return NextResponse.json({ error: "business_id is required" }, { status: 400 });
    const { partnership_id } = body;
    if (!partnership_id) return NextResponse.json({ error: "partnership_id is required" }, { status: 400 });

    const { data: updated, error: acceptErr } = await supabase
      .from("business_partnerships")
      .update({ status: "ACTIVE", accepted_at: new Date().toISOString(), invite_token: null })
      .eq("id", partnership_id)
      .eq("status", "PENDING")
      .neq("initiated_by", business_id)
      .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
      .select(PUBLIC_COLUMNS)
      .maybeSingle();

    if (acceptErr) return NextResponse.json({ error: acceptErr.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Only the invited operator can accept a pending partnership." }, { status: 409 });
    return NextResponse.json({ partnership: updated });
  }

  // --- ACCEPT VIA EMAIL TOKEN ---
  // Hardened: single-use token (cleared on successful accept), rate-limited
  // per-token, requires caller to echo invite_email as proof-of-receipt.
  if (action === "accept_token") {
    const { token } = body;
    const inviteEmailFromCaller = String((body as any).invite_email || "").trim().toLowerCase();
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return NextResponse.json({ error: "A valid invite token is required" }, { status: 400 });
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
    if (!expectedEmail || expectedEmail !== inviteEmailFromCaller) {
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
      .eq("invite_token", token)
      .select(PUBLIC_COLUMNS)
      .maybeSingle();

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
      .update({ status: "REVOKED", revoked_at: new Date().toISOString(), invite_token: null })
      .eq("id", partnership_id)
      .or(`business_a_id.eq.${business_id},business_b_id.eq.${business_id}`)
      .select(PUBLIC_COLUMNS)
      .maybeSingle();

    if (revokeErr) return NextResponse.json({ error: revokeErr.message }, { status: 500 });
    if (!revoked) return NextResponse.json({ error: "Partnership not found." }, { status: 404 });

    // The database trigger deactivates every affected offer in this transaction.
    return NextResponse.json({ partnership: revoked });
  }

  return NextResponse.json({ error: "Invalid action. Must be 'invite', 'accept', 'accept_token', or 'revoke'." }, { status: 400 });
}
