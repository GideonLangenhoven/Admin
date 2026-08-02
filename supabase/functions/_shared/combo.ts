// Shared combo-booking payment helpers.
//
// Used by: paysafe-webhook (async webhook confirm), create-paysafe-checkout
// (synchronous Paysafe process path), yoco-webhook (manual-settlement model
// where operator A collects the full amount via their own Yoco account).
//
// All money-state changes go through the confirm_combo_payment_atomic RPC —
// never hand-mark combo legs PAID, that leaks held capacity and starves the
// webhook's confirmation path.
import {
  formatTenantDate,
  formatTenantDateTime,
  getBusinessDisplayName,
  getTenantByBusinessId,
  sendWhatsappTextForTenant,
} from "./tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Load every leg (booking) of a combo — N-party via combo_booking_items,
// legacy 2-party via booking_a_id/booking_b_id.
export async function loadComboLegs(supabase: any, combo: any): Promise<any[]> {
  const legs: any[] = [];
  const { data: items } = await supabase
    .from("combo_booking_items")
    .select("booking_id")
    .eq("combo_booking_id", combo.id);
  const ids: string[] = (items || []).map((it: any) => it.booking_id);
  if (ids.length === 0) {
    if (combo.booking_a_id) ids.push(combo.booking_a_id);
    if (combo.booking_b_id) ids.push(combo.booking_b_id);
  }
  for (const id of ids) {
    const { data: bk } = await supabase
      .from("bookings")
      .select("*, slots(start_time, booked, held), tours(name)")
      .eq("id", id)
      .single();
    if (bk) legs.push(bk);
  }
  return legs;
}

async function createComboInvoice(supabase: any, booking: any, tourName: string, paymentRef: string, paymentMethod: string) {
  const existing = await supabase.from("invoices").select("*").eq("booking_id", booking.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (existing.data) {
    if (existing.data.payment_reference !== paymentRef) {
      await supabase.from("invoices").update({ payment_method: paymentMethod, payment_reference: paymentRef }).eq("id", existing.data.id);
    }
    return existing.data;
  }

  const invNumR = await supabase.rpc("next_invoice_number", { p_business_id: booking.business_id });
  if (invNumR.error) {
    console.warn("next_invoice_number RPC failed (using fallback):", invNumR.error.message);
  }
  const invNum = invNumR.data || ("INV-" + Date.now());
  const subtotal = Number(booking.total_amount);

  const inv = await supabase.from("invoices").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    invoice_number: invNum,
    customer_name: booking.customer_name,
    customer_email: booking.email,
    customer_phone: booking.phone,
    tour_name: tourName,
    tour_date: booking.slots?.start_time || null,
    qty: booking.qty,
    unit_price: booking.unit_price,
    subtotal: subtotal,
    discount_type: null,
    discount_percent: 0,
    discount_amount: 0,
    total_amount: booking.total_amount,
    payment_method: paymentMethod,
    payment_reference: paymentRef,
  }).select().single();

  if (inv.data) {
    await supabase.from("bookings").update({ invoice_id: inv.data.id }).eq("id", booking.id);
  }
  return { ...inv.data, invoice_number: invNum };
}

async function sendComboLegConfirmation(supabase: any, booking: any, paymentRef: string, paymentMethod: string) {
  let tenant: any = null;
  try {
    tenant = await getTenantByBusinessId(supabase, booking.business_id);
  } catch (tenantErr) {
    console.error("COMBO_CONFIRM_TENANT_ERR:", tenantErr);
  }

  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = booking.tours?.name || "Booking";
  const slotTime = booking.slots?.start_time
    ? (tenant ? formatTenantDateTime(tenant.business, booking.slots.start_time) : new Date(booking.slots.start_time).toLocaleString())
    : "See email";
  const brandName = tenant ? getBusinessDisplayName(tenant.business) : "Your Booking";
  const currency = tenant?.business?.currency || "ZAR";

  let invoice: any = null;
  try {
    invoice = await createComboInvoice(supabase, booking, tourName, paymentRef, paymentMethod);
  } catch (invErr) {
    console.error("COMBO_INVOICE_ERR (continuing):", invErr);
  }

  // Email is the canonical confirmation; WhatsApp only when no email on file.
  if (!booking.email && booking.phone && tenant) {
    try {
      await sendWhatsappTextForTenant(
        tenant,
        booking.phone,
        "Combo booking confirmed\n\n" +
        "Ref: " + ref + "\n" +
        tourName + "\n" +
        slotTime + "\n" +
        booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
        currency + " " + booking.total_amount + " paid\n" +
        "Invoice: " + (invoice?.invoice_number || "pending") + "\n\n" +
        "Thanks for booking with " + brandName + ".",
      );
    } catch (e) {
      console.error("COMBO_WA_CONFIRM_ERR:", e);
    }
  }

  if (booking.email) {
    try {
      await fetch(SUPABASE_URL + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
        body: JSON.stringify({
          type: "BOOKING_CONFIRM",
          data: {
            email: booking.email,
            booking_id: booking.id,
            business_id: booking.business_id,
            customer_name: booking.customer_name,
            customer_email: booking.email,
            ref: ref,
            payment_reference: invoice?.payment_reference || paymentRef,
            tour_name: tourName,
            tour_date: slotTime,
            start_time: slotTime,
            qty: booking.qty,
            total_amount: booking.total_amount,
            invoice_number: invoice?.invoice_number || "",
            invoice_date: tenant ? formatTenantDate(tenant.business, invoice?.created_at || new Date().toISOString()) : "",
          },
        }),
      });
    } catch (e) {
      console.error("COMBO_EMAIL_CONFIRM_ERR:", e);
    }
  }
}

// Confirm every leg of a combo atomically (held→booked, holds CONSUMED,
// bookings PAID, combo row flipped) and send per-operator confirmations.
export async function confirmComboAndNotify(
  supabase: any,
  comboBookingId: string,
  paymentRef: string,
  paymentMethod: string,
): Promise<{ ok: boolean; error?: string; bookingsConfirmed?: number }> {
  const confirmRes = await supabase.rpc("confirm_combo_payment_atomic", {
    p_combo_booking_id: comboBookingId,
    p_paysafe_payment_id: paymentRef,
    p_payment_method: paymentMethod,
  });
  if (confirmRes.error) {
    return { ok: false, error: confirmRes.error.message };
  }

  const { data: combo } = await supabase.from("combo_bookings").select("*").eq("id", comboBookingId).single();
  const legs = combo ? await loadComboLegs(supabase, combo) : [];
  for (const leg of legs) {
    await sendComboLegConfirmation(supabase, leg, paymentRef, paymentMethod);
  }

  return { ok: true, bookingsConfirmed: (confirmRes.data as any)?.bookings_confirmed };
}

// Failed/abandoned combo payment: release held capacity for every leg, guarded
// by the holds row so a replayed webhook (or the cron expiry racing us) can
// never double-decrement. Marks legs PENDING PAYMENT and the combo FAILED.
export async function releaseFailedCombo(supabase: any, combo: any) {
  const legs = await loadComboLegs(supabase, combo);
  for (const leg of legs) {
    // Cancel this leg's ACTIVE hold; only a row we actually flipped releases
    // capacity. If the cron already expired it (and released), we skip.
    const cancelled = await supabase
      .from("holds")
      .update({ status: "CANCELLED" })
      .eq("booking_id", leg.id)
      .eq("status", "ACTIVE")
      .select("id");
    const releasedRows = (cancelled.data || []).length;
    if (releasedRows > 0 && leg.slot_id && Number(leg.qty) > 0) {
      await supabase.rpc("adjust_slot_capacity", {
        p_slot_id: leg.slot_id,
        p_business_id: leg.business_id,
        p_booked_delta: 0,
        p_held_delta: -Number(leg.qty),
      });
    }
    if (["HELD", "PENDING"].includes(String(leg.status))) {
      await supabase.from("bookings").update({ status: "PENDING PAYMENT" }).eq("id", leg.id);
    }
  }
  await supabase.from("combo_bookings").update({ payment_status: "FAILED" }).eq("id", combo.id);
}
