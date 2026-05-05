import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  let body: { email?: string; business_id?: string; type?: string; reason?: string; customer_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { email, business_id, type, reason, customer_id } = body;
  if (!email || !business_id) return NextResponse.json({ error: "email and business_id required" }, { status: 400 });
  if (!type || !["DELETION", "ACCESS", "CORRECTION"].includes(type)) {
    return NextResponse.json({ error: "type must be DELETION, ACCESS, or CORRECTION" }, { status: 400 });
  }

  const db = adminClient();

  // Rate limit: max 1 pending request per email per business per 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db.from("data_subject_requests")
    .select("*", { count: "exact", head: true })
    .eq("business_id", business_id)
    .ilike("email", email)
    .in("status", ["PENDING_CONFIRMATION", "CONFIRMED", "IN_REVIEW"])
    .gte("created_at", sevenDaysAgo);

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "You already have a pending request. Please wait for it to be processed or cancel it first." }, { status: 429 });
  }

  // Generate confirmation token
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: request, error } = await db.from("data_subject_requests").insert({
    business_id,
    customer_id: customer_id || null,
    email,
    request_type: type,
    status: "PENDING_CONFIRMATION",
    reason: reason || null,
    confirmation_token_hash: tokenHash,
    confirmation_expires_at: expiresAt,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send confirmation email via send-email edge function
  const confirmUrl = `${req.headers.get("origin") || supabaseUrl}/popia/confirm?token=${token}&id=${request.id}`;
  await fetch(supabaseUrl + "/functions/v1/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
    body: JSON.stringify({
      type: "POPIA_CONFIRM_REQUEST",
      data: {
        business_id,
        email,
        customer_name: body.reason ? "Customer" : "Customer",
        request_type: type,
        confirm_url: confirmUrl,
        expires_at: expiresAt,
      },
    }),
  });

  return NextResponse.json({ request_id: request.id, expires_at: expiresAt });
}
