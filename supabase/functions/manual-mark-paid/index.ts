// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
import { getWaiverContext } from "../_shared/waiver.ts";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function getCors(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  };
}

async function createInvoice(supabase: any, booking: any, tenant: any, paymentMethod: string) {
  const existing = await supabase.from("invoices").select("*").eq("booking_id", booking.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (existing.data) {
    if (existing.data.payment_method !== paymentMethod) {
      await supabase.from("invoices").update({ payment_method: paymentMethod }).eq("id", existing.data.id);
      existing.data.payment_method = paymentMethod;
    }
    return existing.data;
  }

  const invNumR = await supabase.rpc("next_invoice_number", { p_business_id: booking.business_id });
  const invNum = invNumR.data || "INV-0";
  const subtotal = Number(booking.original_total || booking.total_amount);
  const discountAmt = Math.max(subtotal - Number(booking.total_amount), 0);

  const inv = await supabase.from("invoices").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    invoice_number: invNum,
    customer_name: booking.customer_name,
    customer_email: booking.email,
    customer_phone: booking.phone,
    tour_name: booking.tours?.name || "Booking",
    tour_date: booking.slots?.start_time || null,
    qty: booking.qty,
    unit_price: booking.unit_price,
    subtotal: subtotal,
    discount_type: booking.discount_type || null,
    discount_percent: booking.discount_percent || 0,
    discount_amount: discountAmt,
    total_amount: booking.total_amount,
    payment_method: paymentMethod,
    payment_reference: paymentMethod,
  }).select().single();

  if (inv.data) {
    await supabase.from("bookings").update({ invoice_id: inv.data.id }).eq("id", booking.id);
  }
  return { ...inv.data, invoice_number: invNum };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (authErr: any) {
    return new Response(JSON.stringify({ error: authErr.message }), { status: 401, headers: getCors(req) });
  }

  try {
    const body = await req.json();
    if (body.action !== "mark_paid" || !body.booking_id) {
      return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: getCors(req) });
    }

    const supabase = createServiceClient();
    const bookingRes = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", body.booking_id).maybeSingle();
    const booking = bookingRes.data;
    if (!booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: getCors(req) });

    // Tenant guard: admin can only mark-paid bookings from their own business
    if (!auth.isServiceRole && auth.businessId && booking.business_id !== auth.businessId) {
      return new Response(JSON.stringify({ error: "You can only mark bookings for your own business as paid" }), { status: 403, headers: getCors(req) });
    }

    const tenant = await getTenantByBusinessId(supabase, booking.business_id);
    const brandName = getBusinessDisplayName(tenant.business);

    if (booking.status === "PAID") {
      return new Response(JSON.stringify({ ok: true, message: "Already paid" }), { status: 200, headers: getCors(req) });
    }

    const upd = await supabase.from("bookings")
      .update({ status: "PAID" })
      .eq("id", booking.id)
      .neq("status", "PAID")
      .select("id")
      .maybeSingle();

    if (!upd.data || upd.error) {
      return new Response(JSON.stringify({ error: "Could not mark paid or already paid" }), { status: 400, headers: getCors(req) });
    }

    await supabase.from("holds").update({ status: "CONVERTED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

    const sr = await supabase.from("slots").select("booked, held").eq("id", booking.slot_id).single();
    if (sr.data) {
      await supabase.from("slots").update({
        booked: sr.data.booked + booking.qty,
        held: Math.max(0, sr.data.held - booking.qty),
      }).eq("id", booking.slot_id);
    }

    await supabase.from("logs").insert({ business_id: booking.business_id, booking_id: booking.id, event: "payment_marked_manual", payload: { admin: true } });
    await supabase.from("conversations").update({ current_state: "IDLE", state_data: {}, updated_at: new Date().toISOString() }).eq("phone", booking.phone).eq("business_id", booking.business_id);

    const ref = booking.id.substring(0, 8).toUpperCase();
    const slotTime = booking.slots?.start_time ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "See email";
    const tourName = booking.tours?.name || "Booking";
    const waiver = await getWaiverContext(supabase, { bookingId: booking.id, businessId: booking.business_id });
    const invoice = await createInvoice(supabase, booking, tenant, "Admin (Manual)");

    if (booking.phone) {
      try {
        await sendWhatsappTextForTenant(tenant, booking.phone,
          "Booking confirmed\n\n" +
          "Ref: " + ref + "\n" +
          tourName + "\n" +
          slotTime + "\n" +
          booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
          tenant.business.currency + " " + booking.total_amount + " paid\n" +
          "Invoice: " + (invoice?.invoice_number || "pending") + "\n\n" +
          (waiver.waiverStatus !== "SIGNED" && waiver.waiverLink ? "Waiver: " + waiver.waiverLink + "\n\n" : "") +
          "Thanks for booking with " + brandName + "."
        );
      } catch (e) {
        console.error("WA confirm err:", e);
      }
    }

    if (booking.email && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY },
          body: JSON.stringify({
            type: "BOOKING_CONFIRM",
            data: {
              email: booking.email,
              booking_id: booking.id,
              business_id: booking.business_id,
              waiver_status: waiver.waiverStatus,
              waiver_url: waiver.waiverLink,
              customer_name: booking.customer_name,
              customer_email: booking.email,
              ref: ref,
              payment_reference: invoice?.payment_reference || "Admin Marked Paid",
              tour_name: tourName,
              tour_date: slotTime,
              start_time: slotTime,
              qty: booking.qty,
              total_amount: booking.total_amount,
              invoice_number: invoice?.invoice_number || "",
            },
          }),
        });
      } catch (e) {
        console.log("confirm email err", e);
      }
    }

    return new Response(JSON.stringify({ ok: true, message: "Marked paid, slot updated, invoice created, notifications sent." }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("MARK_PAID_ERR:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: getCors(req) });
  }
});
