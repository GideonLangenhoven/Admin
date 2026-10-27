// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDate, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
import { getWaiverContext } from "../_shared/waiver.ts";
import { requireAuth, canAccessBusiness } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function getCors(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  };
}

async function createInvoice(supabase: any, booking: any, tenant: any, paymentMethod: string, paymentReference: string) {
  const existing = await supabase.from("invoices").select("*").eq("booking_id", booking.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (existing.data) {
    if (existing.data.payment_method !== paymentMethod || existing.data.payment_reference !== paymentReference) {
      await supabase.from("invoices").update({ payment_method: paymentMethod, payment_reference: paymentReference }).eq("id", existing.data.id);
      existing.data.payment_method = paymentMethod;
      existing.data.payment_reference = paymentReference;
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
    payment_reference: paymentReference,
  }).select().single();

  if (inv.error || !inv.data) throw new Error("Invoice insert failed: " + (inv.error?.message || "No invoice returned"));
  await supabase.from("bookings").update({ invoice_id: inv.data.id }).eq("id", booking.id);
  return inv.data;
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
    if (!["mark_paid", "reserve_capacity"].includes(body.action) || !body.booking_id) {
      return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: getCors(req) });
    }
    // Optional: caller can specify how the payment was received so the
    // invoice/audit log records "Cash", "EFT", "Card (terminal)", etc.
    // Falls back to "Admin (Manual)" for back-compat with older callers.
    const rawMethod = String(body.payment_method || "").trim();
    const allowedMethods = ["Cash", "EFT", "Card (terminal)", "Other"];
    const paymentMethod = allowedMethods.includes(rawMethod) ? rawMethod : "Admin (Manual)";
    const paymentNote = String(body.payment_note || "").trim().slice(0, 280);
    const paymentReference = String(body.payment_reference || "").trim().slice(0, 80);
    // Optional amount for a deposit or part-payment; omitted means the full
    // balance (bulk Mark Paid, voucher-covered bookings, older callers).
    let amount: number | null = null;
    if (body.amount != null) {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
        return new Response(JSON.stringify({ error: "Enter the amount received in rand and cents." }), { status: 400, headers: getCors(req) });
      }
      amount = Math.round(amount * 100) / 100;
    }
    // What the operator saw as already received, so a retried request cannot
    // record the same payment twice.
    const expectedCaptured = body.expected_captured == null ? null : Number(body.expected_captured);
    if (expectedCaptured !== null && !Number.isFinite(expectedCaptured)) {
      return new Response(JSON.stringify({ error: "Refresh the booking and try again." }), { status: 400, headers: getCors(req) });
    }

    const supabase = createServiceClient();
    const bookingRes = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", body.booking_id).maybeSingle();
    const booking = bookingRes.data;
    if (!booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: getCors(req) });

    // Tenant guard: admin can only mark-paid bookings from their own business
    if (!canAccessBusiness(auth, booking.business_id)) {
      return new Response(JSON.stringify({ error: "You can only mark bookings for your own business as paid" }), { status: 403, headers: getCors(req) });
    }

    const tenant = await getTenantByBusinessId(supabase, booking.business_id);
    const brandName = getBusinessDisplayName(tenant.business);

    const accounted = await supabase.rpc("account_manual_booking", {
      p_booking_id: booking.id, p_business_id: booking.business_id,
      p_mark_paid: body.action === "mark_paid", p_payment_method: paymentMethod,
      p_amount: amount, p_expected_captured: expectedCaptured,
    });
    if (accounted.error || !accounted.data?.ok) {
      if (accounted.error) console.error("MARK_PAID_RPC_ERR:", accounted.error);
      return new Response(JSON.stringify({ error: accounted.data?.error || "The payment could not be recorded. Please try again." }), { status: 409, headers: getCors(req) });
    }
    if (body.action === "reserve_capacity" || accounted.data.already_paid) return new Response(JSON.stringify(accounted.data), { headers: getCors(req) });

    const received = Number(accounted.data.amount || 0);
    const balanceDue = Number(accounted.data.balance_due || 0);
    const paidInFull = balanceDue <= 0.005;
    // A booking still pending gets its one "Booking Confirmed!"; one already
    // confirmed (money due, or a deposit) was told so before and gets a receipt.
    const firstConfirmation = ["PENDING", "PENDING PAYMENT", "HELD"].includes(String(accounted.data.previous_status));
    const recorded = { ok: true, amount: received, balance_due: balanceDue, paid_in_full: paidInFull };
    let notified = "none";
    try {
      const after = await supabase.from("bookings").select("total_captured").eq("id", booking.id).eq("business_id", booking.business_id).single();
      const receivedToDate = Number(after.data?.total_captured ?? booking.total_amount);

      await supabase.from("logs").insert({ business_id: booking.business_id, booking_id: booking.id, event: "payment_marked_manual", payload: {
        admin: true, amount: received, balance_due: balanceDue, payment_method: paymentMethod,
        payment_reference: paymentReference || null, payment_note: paymentNote || null, user_id: auth?.userId || null,
      } });
      await supabase.from("conversations").update({ current_state: "IDLE", state_data: {}, updated_at: new Date().toISOString() }).eq("phone", booking.phone).eq("business_id", booking.business_id);

      const ref = booking.id.substring(0, 8).toUpperCase();
      const slotTime = booking.slots?.start_time ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "See email";
      const tourName = booking.tours?.name || "Booking";
      const waiver = await getWaiverContext(supabase, { bookingId: booking.id, businessId: booking.business_id });
      const invoice = await createInvoice(supabase, booking, tenant, paymentMethod, paymentReference || paymentNote || paymentMethod);
      const money = (n: number) => "R" + n.toFixed(2);

      // Email is the canonical notification; WhatsApp only when no email on file.
      if (!booking.email && booking.phone) {
        try {
          await sendWhatsappTextForTenant(tenant, booking.phone, firstConfirmation
            ? "Booking confirmed\n\n" +
              "Ref: " + ref + "\n" +
              tourName + "\n" +
              slotTime + "\n" +
              booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
              money(receivedToDate) + " paid" + (paidInFull ? "" : ", " + money(balanceDue) + " still due") + "\n" +
              "Invoice: " + (invoice?.invoice_number || "pending") + "\n\n" +
              (waiver.waiverStatus !== "SIGNED" && waiver.waiverLink ? "Waiver: " + waiver.waiverLink + "\n\n" : "") +
              "Thanks for booking with " + brandName + "."
            : "Payment received\n\n" +
              "Ref: " + ref + "\n" +
              tourName + "\n" +
              money(received) + " received (" + paymentMethod + ")\n" +
              (paidInFull ? "Your booking is paid in full." : "Still due: " + money(balanceDue)) + "\n\n" +
              "Thanks, " + brandName + ".");
          notified = "whatsapp";
        } catch (e) {
          console.error("WA payment notice err:", e);
          notified = "whatsapp_failed";
        }
      }

      const email = String(booking.email || "").trim().toLowerCase();
      if (email && firstConfirmation) {
        // send-email queues this under the booking's one confirmation job.
        const res = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY },
          body: JSON.stringify({
            type: "BOOKING_CONFIRM",
            data: {
              email,
              booking_id: booking.id,
              business_id: booking.business_id,
              waiver_status: waiver.waiverStatus,
              waiver_url: waiver.waiverLink,
              customer_name: booking.customer_name,
              customer_email: email,
              ref: ref,
              payment_reference: invoice?.payment_reference || "Admin Marked Paid",
              tour_name: tourName,
              tour_date: slotTime,
              start_time: slotTime,
              qty: booking.qty,
              total_amount: booking.total_amount,
              invoice_number: invoice?.invoice_number || "",
              invoice_date: formatTenantDate(tenant.business, invoice?.created_at || new Date().toISOString()),
            },
          }),
        });
        if (!res.ok) throw new Error("Confirmation could not be queued: HTTP " + res.status);
        notified = "confirmation";
      } else if (email) {
        // The receipt is the updated invoice; send-email reads what was
        // received and what is still due from the booking. One job per payment,
        // keyed on the new total received.
        const queued = await supabase.from("notification_jobs").upsert({
          business_id: booking.business_id,
          booking_id: booking.id,
          source_type: "MANUAL_PAYMENT",
          source_id: booking.id,
          template_type: "INVOICE",
          recipient: email,
          payload: {
            business_id: booking.business_id, booking_id: booking.id, customer_name: booking.customer_name, customer_email: email,
            invoice_number: invoice?.invoice_number || "", invoice_date: formatTenantDate(tenant.business, new Date().toISOString()),
            tour_name: tourName, tour_date_raw: booking.slots?.start_time || null, qty: booking.qty, unit_price: booking.unit_price,
            discount_type: booking.discount_type || null, discount_percent: booking.discount_percent || 0,
            discount_amount: invoice?.discount_amount || 0, total_amount: booking.total_amount,
            payment_method: paymentMethod, payment_reference: ref,
          },
          dedupe_key: "manual-payment/" + booking.id + "/" + Math.round(receivedToDate * 100),
        }, { onConflict: "dedupe_key", ignoreDuplicates: true });
        if (queued.error) throw new Error("Receipt could not be queued: " + queued.error.message);
        notified = "receipt";
      }
    } catch (err) {
      // The payment itself is recorded; say so rather than inviting a retry.
      console.error("MARK_PAID_FOLLOWUP_ERR:", err);
      return new Response(JSON.stringify({ ...recorded, notified, warning: "The payment was recorded, but the guest could not be notified. Check Failed Notifications or resend from Invoices." }), { status: 200, headers: getCors(req) });
    }

    return new Response(JSON.stringify({ ...recorded, notified }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("MARK_PAID_ERR:", err);
    return new Response(JSON.stringify({ error: "The payment could not be recorded. Please try again." }), { status: 500, headers: getCors(req) });
  }
});
