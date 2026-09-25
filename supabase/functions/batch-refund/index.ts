// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createServiceClient();
const REFUND_ADMIN_ROLES = new Set(["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"]);

type BatchStatus = "completed" | "pending" | "manual_action" | "failed" | "unknown" | "unprocessed";
type BatchResult = { booking_id: string; status: BatchStatus; ok: boolean; error?: string; amount?: number; refund_status?: string };

async function classifyRefundResponse(bookingId: string, response: Response): Promise<BatchResult> {
  let data: any;
  try {
    data = await response.json();
  } catch {
    return { booking_id: bookingId, status: "unknown", ok: false, error: "Refund response could not be read" };
  }
  const amount = Number(data?.amount);
  const details = {
    ...(Number.isFinite(amount) ? { amount } : {}),
    ...(typeof data?.refund_status === "string" ? { refund_status: data.refund_status } : {}),
  };
  if (data?.refund_status === "MANUAL_EFT_REQUIRED") {
    return { booking_id: bookingId, status: "manual_action", ok: false, ...details };
  }
  if (response.status === 202 || data?.pending === true || data?.refund_status === "REFUND_PENDING") {
    return { booking_id: bookingId, status: "pending", ok: false, error: data?.error, ...details };
  }
  if (response.ok && data?.ok === true && (data.refund_status === "REFUNDED" || data.channel === "voucher" || data.already_refunded === true)) {
    return { booking_id: bookingId, status: "completed", ok: true, ...details };
  }
  if (data?.refund_status === "FAILED" || (response.status < 500 && (!response.ok || data?.ok === false || data?.error))) {
    return { booking_id: bookingId, status: "failed", ok: false, error: data?.error || "Refund request failed", ...details };
  }
  return { booking_id: bookingId, status: "unknown", ok: false, error: data?.error || "Refund outcome could not be confirmed", ...details };
}

function summarize(results: BatchResult[], total: number) {
  const count = (status: BatchStatus) => results.filter(result => result.status === status).length;
  const completed = count("completed");
  const pending = count("pending");
  const manualAction = count("manual_action");
  const failed = count("failed");
  const unknown = count("unknown");
  const unprocessed = count("unprocessed");
  return {
    ok: pending === 0 && manualAction === 0 && failed === 0 && unknown === 0 && unprocessed === 0,
    total,
    processed: results.length - unprocessed,
    succeeded: completed,
    completed,
    pending,
    manual_action: manualAction,
    failed,
    unknown,
    unprocessed,
    results,
  };
}

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });
  const respond = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: getCors(req) });

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (authErr: any) {
    return respond({ error: authErr.message }, 401);
  }
  if (!auth.isServiceRole && !REFUND_ADMIN_ROLES.has(auth.role)) return respond({ error: "Refund access required" }, 403);

  try {
    const body = await req.json();
    const { booking_ids } = body;

    if (!Array.isArray(booking_ids) || booking_ids.length === 0 || booking_ids.some((id: unknown) => typeof id !== "string" || !id)) {
      return respond({ error: "booking_ids array required" }, 400);
    }

    if (booking_ids.length > 100) {
      return respond({ error: "Maximum 100 bookings per batch" }, 400);
    }
    if (new Set(booking_ids).size !== booking_ids.length) return respond({ error: "Duplicate booking IDs are not allowed" }, 400);

    let bookingQuery = supabase.from("bookings").select("id, business_id").in("id", booking_ids);
    // Ordinary admins are scoped in SQL. The two intentionally cross-tenant
    // caller classes still derive one tenant from these minimal booking rows.
    if (!auth.isServiceRole && auth.role !== "SUPER_ADMIN") bookingQuery = bookingQuery.eq("business_id", auth.businessId);
    const loaded = await bookingQuery;
    if (loaded.error) return respond({ error: "Could not verify batch bookings" }, 503);
    const bookings = loaded.data || [];
    if (bookings.length !== booking_ids.length) {
      return respond({ error: auth.isServiceRole || auth.role === "SUPER_ADMIN" ? "Some bookings were not found" : "Some bookings do not belong to your business" }, auth.isServiceRole || auth.role === "SUPER_ADMIN" ? 404 : 403);
    }
    if (!auth.isServiceRole && auth.role !== "SUPER_ADMIN" && bookings.some((booking: any) => booking.business_id !== auth.businessId)) {
      return respond({ error: "Some bookings do not belong to your business" }, 403);
    }
    const businessIds = [...new Set(bookings.map((booking: any) => booking.business_id))];
    if (businessIds.length !== 1) return respond({ error: "A refund batch must contain bookings from one business" }, 400);
    const businessId = businessIds[0] as string;
    if (!businessId) return respond({ error: "Batch bookings are missing tenant ownership" }, 409);

    const batchId = crypto.randomUUID();
    const results: BatchResult[] = [];
    const audit = async (event: string) => {
      const { error } = await supabase.from("logs").upsert({
        id: batchId,
        business_id: businessId,
        event,
        payload: { actor_user_id: auth.userId, ...summarize(results, booking_ids.length) },
      }, { onConflict: "id" });
      return error;
    };
    const initialAuditError = await audit("batch_refund_started");
    if (initialAuditError) return respond({ error: "Could not persist batch refund audit" }, 503);

    const downstreamHeaders: Record<string, string> = { "Content-Type": "application/json" };
    const authorization = req.headers.get("authorization") || req.headers.get("Authorization");
    const apiKey = req.headers.get("apikey");
    if (authorization) downstreamHeaders.Authorization = authorization;
    if (apiKey) downstreamHeaders.apikey = apiKey;

    for (let i = 0; i < booking_ids.length; i++) {
      const bookingId = booking_ids[i];
      try {
        const refundRes = await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
          method: "POST",
          headers: downstreamHeaders,
          body: JSON.stringify({ booking_id: bookingId }),
        });
        results.push(await classifyRefundResponse(bookingId, refundRes));
      } catch (err: any) {
        results.push({ booking_id: bookingId, status: "unknown", ok: false, error: err.message || "Refund outcome could not be confirmed" });
      }
      const progressAuditError = await audit("batch_refund_progress");
      if (progressAuditError) {
        for (const unprocessedId of booking_ids.slice(i + 1)) {
          results.push({ booking_id: unprocessedId, status: "unprocessed", ok: false, error: "Batch stopped because its audit record could not be persisted" });
        }
        return respond({ batch_id: batchId, ...summarize(results, booking_ids.length), ok: false, audit_error: "Could not persist batch refund audit" }, 503);
      }
    }

    const finalAuditError = await audit("batch_refund_complete");
    const summary = { batch_id: batchId, ...summarize(results, booking_ids.length) };
    if (finalAuditError) return respond({ ...summary, ok: false, audit_error: "Could not persist final batch refund audit" }, 503);
    return respond(summary);
  } catch (err: any) {
    console.error("BATCH_REFUND_ERROR:", err);
    return respond({ error: err.message || "Internal error" }, 500);
  }
});
