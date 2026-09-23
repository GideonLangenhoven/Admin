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
type StoredResult = Omit<BatchResult, "status"> & { status: BatchStatus | "submitting" };
type BatchRecord = { id: string; business_id: string; actor_user_id: string; actor_role: string; booking_ids: string[]; results: Record<string, StoredResult> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function recordedResults(batch: BatchRecord): BatchResult[] {
  return batch.booking_ids.map(bookingId => {
    const result = batch.results?.[bookingId];
    if (!result || result.status === "submitting") {
      return { booking_id: bookingId, status: "unknown", ok: false, error: "Submission outcome needs reconciliation" };
    }
    return result as BatchResult;
  });
}

function batchSummary(batch: BatchRecord) {
  return { batch_id: batch.id, ...summarize(recordedResults(batch), batch.booking_ids.length) };
}

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
    const action = body.action || "start";
    const batchId = String(body.batch_id || "");
    if (!UUID.test(batchId) || !["start", "status", "resume"].includes(action)) return respond({ error: "Valid batch_id and action required" }, 400);
    const bookingIds: string[] = body.booking_ids;
    let businessId = String(body.business_id || "");
    let batch: BatchRecord;
    const loadBatch = (targetBusiness: string) => supabase.from("refund_batches")
      .select("id,business_id,actor_user_id,actor_role,booking_ids,results")
      .eq("id", batchId).eq("business_id", targetBusiness).maybeSingle();
    const reconcileSubmitting = async (record: BatchRecord) => {
      const submitted = record.booking_ids.filter(id => record.results?.[id]?.status === "submitting");
      if (submitted.length === 0) return true;
      const current = await supabase.from("bookings")
        .select("id,refund_status,refund_request_id").eq("business_id", record.business_id).in("id", submitted);
      if (current.error || !Array.isArray(current.data)) return false;
      for (const booking of current.data) {
        const status = booking.refund_status === "REFUNDED" ? "completed"
          : booking.refund_status === "MANUAL_EFT_REQUIRED" ? "manual_action"
            : booking.refund_status === "REFUND_PENDING" && booking.refund_request_id ? "pending" : null;
        if (!status) continue;
        const result: BatchResult = { booking_id: booking.id, status, ok: status === "completed", refund_status: booking.refund_status };
        const saved = await supabase.rpc("record_refund_batch_item", { p_batch_id: record.id, p_booking_id: booking.id, p_result: result });
        if (saved.error || !saved.data) return false;
        record.results[booking.id] = result;
      }
      return true;
    };

    if (action === "start") {
      if (!Array.isArray(bookingIds) || bookingIds.length === 0 || bookingIds.some(id => typeof id !== "string" || !id)) {
        return respond({ error: "booking_ids array required" }, 400);
      }
      if (bookingIds.length > 100) return respond({ error: "Maximum 100 bookings per batch" }, 400);
      if (new Set(bookingIds).size !== bookingIds.length) return respond({ error: "Duplicate booking IDs are not allowed" }, 400);
      let bookingQuery = supabase.from("bookings").select("id,business_id").in("id", bookingIds);
      if (!auth.isServiceRole && auth.role !== "SUPER_ADMIN") bookingQuery = bookingQuery.eq("business_id", auth.businessId);
      const loaded = await bookingQuery;
      if (loaded.error) return respond({ error: "Could not verify batch bookings" }, 503);
      const bookings = loaded.data || [];
      if (bookings.length !== bookingIds.length) {
        return respond({ error: auth.isServiceRole || auth.role === "SUPER_ADMIN" ? "Some bookings were not found" : "Some bookings do not belong to your business" }, auth.isServiceRole || auth.role === "SUPER_ADMIN" ? 404 : 403);
      }
      const businessIds = [...new Set(bookings.map((booking: any) => booking.business_id))];
      if (businessIds.length !== 1) return respond({ error: "A refund batch must contain bookings from one business" }, 400);
      businessId = businessIds[0] as string;
      if (!businessId || (body.business_id && body.business_id !== businessId)) return respond({ error: "Batch bookings are missing tenant ownership" }, 409);
    } else if (!businessId || (!auth.isServiceRole && auth.role !== "SUPER_ADMIN" && businessId !== auth.businessId)) {
      return respond({ error: "Business target required" }, 403);
    }

    const existing = await loadBatch(businessId);
    if (existing.error) return respond({ error: "Could not verify batch acceptance" }, 503);
    if (existing.data) {
      batch = existing.data as BatchRecord;
      if (batch.actor_user_id !== auth.userId || batch.business_id !== businessId ||
          (action === "start" && JSON.stringify(batch.booking_ids) !== JSON.stringify(bookingIds))) {
        return respond({ error: "Batch belongs to a different request" }, 403);
      }
      if (!await reconcileSubmitting(batch)) return respond({ ...batchSummary(batch), ok: false, error: "Could not reconcile submitted items" }, 503);
      if (action !== "resume") return respond(batchSummary(batch));
    } else {
      if (action !== "start") return respond({ error: "Batch not found" }, 404);
      const accepted: BatchRecord = {
        id: batchId, business_id: businessId, actor_user_id: auth.userId, actor_role: auth.role,
        booking_ids: bookingIds,
        results: Object.fromEntries(bookingIds.map(id => [id, { booking_id: id, status: "unprocessed", ok: false }])),
      };
      const inserted = await supabase.from("refund_batches").insert(accepted)
        .select("id,business_id,actor_user_id,actor_role,booking_ids,results").single();
      if (inserted.error) {
        if (inserted.error.code !== "23505") return respond({ error: "Could not persist accepted batch" }, 503);
        const raced = await loadBatch(businessId);
        if (raced.error || !raced.data) return respond({ error: "Batch acceptance could not be confirmed" }, 503);
        batch = raced.data as BatchRecord;
        if (batch.actor_user_id !== auth.userId || JSON.stringify(batch.booking_ids) !== JSON.stringify(bookingIds)) return respond({ error: "Batch belongs to a different request" }, 403);
        if (!await reconcileSubmitting(batch)) return respond({ ...batchSummary(batch), ok: false, error: "Could not reconcile submitted items" }, 503);
        return respond(batchSummary(batch));
      }
      if (!inserted.data) return respond({ error: "Batch acceptance could not be confirmed" }, 503);
      batch = inserted.data as BatchRecord;
    }

    const audit = async (event: string) => (await supabase.from("logs").upsert({
      id: batchId, business_id: businessId, event,
      payload: { actor_user_id: auth.userId, ...batchSummary(batch) },
    }, { onConflict: "id" })).error;
    if (await audit(action === "start" ? "batch_refund_started" : "batch_refund_resumed")) {
      return respond({ ...batchSummary(batch), ok: false, audit_error: "Could not persist batch refund audit" }, 503);
    }

    const downstreamHeaders: Record<string, string> = { "Content-Type": "application/json" };
    const authorization = req.headers.get("authorization") || req.headers.get("Authorization");
    const apiKey = req.headers.get("apikey");
    if (authorization) downstreamHeaders.Authorization = authorization;
    if (apiKey) downstreamHeaders.apikey = apiKey;

    for (const bookingId of batch.booking_ids) {
      if (batch.results[bookingId]?.status !== "unprocessed") continue;
      const claimed = await supabase.rpc("claim_refund_batch_item", { p_batch_id: batchId, p_booking_id: bookingId });
      if (claimed.error || !claimed.data) {
        batch.results[bookingId] = { booking_id: bookingId, status: "submitting", ok: false };
        return respond({ ...batchSummary(batch), ok: false, audit_error: "Batch item state could not be confirmed; reconcile before retrying" }, 503);
      }
      batch.results[bookingId] = { booking_id: bookingId, status: "submitting", ok: false };
      let result: BatchResult;
      try {
        const refundRes = await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
          method: "POST",
          headers: downstreamHeaders,
          body: JSON.stringify({ booking_id: bookingId }),
          signal: AbortSignal.timeout(10000),
        });
        result = await classifyRefundResponse(bookingId, refundRes);
      } catch (err: any) {
        result = { booking_id: bookingId, status: "unknown", ok: false, error: "Refund outcome could not be confirmed" };
      }
      const recorded = await supabase.rpc("record_refund_batch_item", { p_batch_id: batchId, p_booking_id: bookingId, p_result: result });
      if (recorded.error || !recorded.data) return respond({ ...batchSummary(batch), ok: false, audit_error: "Refund result could not be persisted; reconcile before retrying" }, 503);
      batch.results[bookingId] = result;
      if (await audit("batch_refund_progress")) return respond({ ...batchSummary(batch), ok: false, audit_error: "Could not persist batch refund audit" }, 503);
    }

    const finalAuditError = await audit("batch_refund_complete");
    const summary = batchSummary(batch);
    if (finalAuditError) return respond({ ...summary, ok: false, audit_error: "Could not persist final batch refund audit" }, 503);
    return respond(summary);
  } catch (err: any) {
    console.error("BATCH_REFUND_ERROR:", err);
    return respond({ error: err.message || "Internal error" }, 500);
  }
});
