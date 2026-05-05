import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

/**
 * Verify the caller is an authenticated admin and return their business_id + role.
 * Returns null if no/invalid session.
 */
async function verifyAdminSession(req: NextRequest, supabase: any) {
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
    return { user_id: userRes.user.id as string, business_id: admin.business_id as string, role: admin.role as string };
  } catch {
    return null;
  }
}

// POST /api/combo-cancel
// Cancels combo booking legs and issues vouchers (one per operator).
//
// Customer-initiated: cancels ALL legs → N vouchers (one per operator).
//   Body must include `customer_email` matching the combo booking on file.
//
// Operator-initiated: cancels ONLY their leg → 1 voucher for their portion.
//   Caller must send a valid admin session via `Authorization: Bearer <token>`.
//   The session's business_id must match the body's business_id (unless SUPER_ADMIN).
//
// body: { combo_booking_id, initiated_by, business_id?, customer_email?, reason? }
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { combo_booking_id, initiated_by, business_id, reason } = body;
  if (!combo_booking_id) return NextResponse.json({ error: "combo_booking_id is required" }, { status: 400 });
  if (!initiated_by || !["customer", "operator"].includes(initiated_by)) {
    return NextResponse.json({ error: "initiated_by must be 'customer' or 'operator'" }, { status: 400 });
  }
  if (initiated_by === "operator" && !business_id) {
    return NextResponse.json({ error: "business_id is required for operator-initiated cancellations" }, { status: 400 });
  }

  const supabase = serviceClient();

  // Load combo booking
  const { data: combo, error: comboErr } = await supabase
    .from("combo_bookings")
    .select("*")
    .eq("id", combo_booking_id)
    .maybeSingle();

  if (comboErr || !combo) return NextResponse.json({ error: "Combo booking not found" }, { status: 404 });
  if (combo.payment_status !== "PAID") return NextResponse.json({ error: "Only PAID combo bookings can be cancelled" }, { status: 400 });

  // ── Authentication gate ──────────────────────────────────────────────────────
  if (initiated_by === "operator") {
    const session = await verifyAdminSession(req, supabase);
    if (!session) {
      return NextResponse.json({ error: "Admin authentication required. Log in and try again." }, { status: 401 });
    }
    // Non-super admins must act on their own business_id
    if (!/super/i.test(session.role || "") && session.business_id !== business_id) {
      return NextResponse.json({ error: "You can only cancel bookings for your own business." }, { status: 403 });
    }
  } else {
    // Customer path — verify claimed email against the combo record (case-insensitive)
    const customerEmail = String(body.customer_email || "").trim().toLowerCase();
    const comboEmail = String(combo.customer_email || "").trim().toLowerCase();
    if (!customerEmail) {
      return NextResponse.json({ error: "customer_email is required for customer-initiated cancellations." }, { status: 400 });
    }
    if (!comboEmail || customerEmail !== comboEmail) {
      return NextResponse.json({ error: "Email does not match this booking." }, { status: 403 });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Load all booking items for this combo
  let { data: comboItems } = await supabase
    .from("combo_booking_items")
    .select("id, booking_id, business_id, split_amount, position")
    .eq("combo_booking_id", combo_booking_id)
    .order("position");

  // Fallback to legacy A/B if no items (old 2-party combos)
  if (!comboItems || comboItems.length === 0) {
    comboItems = [];
    if (combo.booking_a_id) {
      const { data: bA } = await supabase.from("bookings").select("business_id").eq("id", combo.booking_a_id).single();
      comboItems.push({ id: null, booking_id: combo.booking_a_id, business_id: bA?.business_id, split_amount: combo.split_a_amount, position: 1 });
    }
    if (combo.booking_b_id) {
      const { data: bB } = await supabase.from("bookings").select("business_id").eq("id", combo.booking_b_id).single();
      comboItems.push({ id: null, booking_id: combo.booking_b_id, business_id: bB?.business_id, split_amount: combo.split_b_amount, position: 2 });
    }
  }

  const nowIso = new Date().toISOString();
  const cancelReason = reason || (initiated_by === "customer" ? "Customer requested combo cancellation" : "Operator cancelled");
  const vouchers: any[] = [];
  const cancelledBookingIds: string[] = [];

  // Determine which items to cancel
  const itemsToCancel = initiated_by === "customer"
    ? comboItems  // Cancel all legs
    : (comboItems || []).filter((item: any) => item.business_id === business_id);  // Only this operator's leg(s)

  if (itemsToCancel.length === 0) {
    return NextResponse.json({ error: "No bookings found for this business in this combo" }, { status: 403 });
  }

  // Cancel each booking and create a voucher per operator
  for (const item of itemsToCancel as any[]) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, business_id, tour_id, customer_name, email, phone, total_amount, status, tours(name)")
      .eq("id", item.booking_id)
      .single();

    if (!booking || booking.status === "CANCELLED") continue;

    await supabase.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: cancelReason,
      cancelled_at: nowIso,
    }).eq("id", item.booking_id);

    cancelledBookingIds.push(item.booking_id);

    const voucherAmount = Number(item.split_amount || booking.total_amount || 0);
    if (voucherAmount <= 0) continue;

    const voucherCode = "COMBO-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const { data: voucher, error: voucherErr } = await supabase.from("vouchers").insert({
      business_id: booking.business_id,
      code: voucherCode,
      type: "FIXED",
      value_amount: voucherAmount,
      current_balance: voucherAmount,
      status: "ACTIVE",
      expires_at: expiresAt,
      source_booking_id: item.booking_id,
      buyer_name: booking.customer_name || combo.customer_name,
      buyer_email: booking.email || combo.customer_email,
      buyer_phone: booking.phone || combo.customer_phone,
      tour_name: (booking.tours as any)?.name || "Combo tour",
    }).select().single();

    if (voucherErr) {
      console.error("COMBO_VOUCHER_ERR:", voucherErr.message);
    } else {
      vouchers.push({
        voucher_id: voucher.id,
        code: voucherCode,
        amount: voucherAmount,
        business_id: booking.business_id,
        tour_name: (booking.tours as any)?.name || "Tour",
        expires_at: expiresAt,
      });
    }
  }

  // Update combo booking status
  const totalItems = (comboItems || []).length;
  const allCancelledNow = cancelledBookingIds.length === totalItems;
  const newStatus = allCancelledNow ? "CANCELLED" : "VOUCHER_ISSUED";

  await supabase.from("combo_bookings").update({ payment_status: newStatus }).eq("id", combo_booking_id);

  await supabase.from("logs").insert({
    business_id: business_id || combo.customer_email,
    event: "combo_cancellation",
    payload: {
      combo_booking_id,
      initiated_by,
      cancelled_bookings: cancelledBookingIds,
      vouchers_issued: vouchers.length,
      total_items: totalItems,
      reason: cancelReason,
    },
  });

  return NextResponse.json({
    ok: true,
    cancelled_bookings: cancelledBookingIds.length,
    total_items: totalItems,
    vouchers,
    combo_status: newStatus,
  });
}
