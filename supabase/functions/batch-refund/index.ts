// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getAdminAppOrigins } from "../_shared/tenant.ts";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = origins.includes(origin) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (authErr: any) {
    return new Response(JSON.stringify({ error: authErr.message }), { status: 401, headers: getCors(req) });
  }

  try {
    const body = await req.json();
    const { booking_ids } = body;

    if (!Array.isArray(booking_ids) || booking_ids.length === 0) {
      return new Response(JSON.stringify({ error: "booking_ids array required" }), { status: 400, headers: getCors(req) });
    }

    if (booking_ids.length > 100) {
      return new Response(JSON.stringify({ error: "Maximum 100 bookings per batch" }), { status: 400, headers: getCors(req) });
    }

    // Tenant guard: verify all bookings belong to the authenticated admin's business
    if (!auth.isServiceRole && auth.businessId) {
      const { data: owned } = await supabase.from("bookings").select("id").in("id", booking_ids).eq("business_id", auth.businessId);
      const ownedIds = new Set((owned || []).map((b: any) => b.id));
      const foreign = booking_ids.filter((id: string) => !ownedIds.has(id));
      if (foreign.length > 0) {
        return new Response(JSON.stringify({ error: "Some booking IDs do not belong to your business", foreign_ids: foreign }), { status: 403, headers: getCors(req) });
      }
    }

    // Create a batch record so the frontend can track progress
    const batchId = crypto.randomUUID();
    const results: Array<{ booking_id: string; ok: boolean; error?: string; amount?: number }> = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < booking_ids.length; i++) {
      const bookingId = booking_ids[i];
      try {
        // Call the existing process-refund edge function for each booking
        const refundRes = await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + SUPABASE_KEY,
          },
          body: JSON.stringify({ booking_id: bookingId }),
        });

        const refundData = await refundRes.json();

        if (!refundRes.ok || refundData?.error) {
          failed++;
          results.push({ booking_id: bookingId, ok: false, error: refundData?.error || "Refund request failed" });

          // Update refund_status to FAILED if process-refund didn't already
          await supabase.from("bookings").update({
            refund_status: "FAILED",
            refund_notes: "Batch refund failed: " + (refundData?.error || "Unknown error"),
          }).eq("id", bookingId).is("refund_status", null);
        } else {
          succeeded++;
          results.push({ booking_id: bookingId, ok: true, amount: refundData.amount });
        }
      } catch (err: any) {
        failed++;
        results.push({ booking_id: bookingId, ok: false, error: err.message || "Internal error" });

        await supabase.from("bookings").update({
          refund_status: "FAILED",
          refund_notes: "Batch refund error: " + (err.message || "Unknown"),
        }).eq("id", bookingId).is("refund_status", null);
      }

      processed++;

      // Update progress in a log entry so frontend can poll
      await supabase.from("logs").upsert({
        id: batchId,
        business_id: body.business_id || "",
        event: "batch_refund_progress",
        payload: { total: booking_ids.length, processed, succeeded, failed, results },
      }, { onConflict: "id" }).then(() => {});
    }

    // Final log update
    await supabase.from("logs").upsert({
      id: batchId,
      business_id: body.business_id || "",
      event: "batch_refund_complete",
      payload: { total: booking_ids.length, processed, succeeded, failed, results },
    }, { onConflict: "id" });

    return new Response(JSON.stringify({
      ok: true,
      batch_id: batchId,
      total: booking_ids.length,
      succeeded,
      failed,
      results,
    }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("BATCH_REFUND_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
