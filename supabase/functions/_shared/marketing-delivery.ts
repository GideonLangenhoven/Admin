// The database reservation is the durable boundary before any provider call.
// Existing/uncertain intents never retry automatically, even after Resend's 24h key window.
export async function reserveMarketingDelivery(db: any, input: {
  businessId: string; contactId: string; key: string; payload: Record<string, unknown>;
  queueId?: string; enrollmentId?: string;
}): Promise<{ reason: string; id?: string }> {
  const { data, error } = await db.rpc("reserve_marketing_delivery", {
    p_business_id: input.businessId, p_contact_id: input.contactId, p_key: input.key,
    p_payload: input.payload, p_queue_id: input.queueId || null, p_enrollment_id: input.enrollmentId || null,
  });
  if (error || !data?.reason) throw new Error("Marketing delivery reservation unavailable");
  return data;
}

export async function confirmMarketingDelivery(db: any, businessId: string, id: string): Promise<string> {
  const { data, error } = await db.rpc("confirm_marketing_delivery", { p_business_id: businessId, p_delivery_id: id });
  if (error || typeof data !== "string") throw new Error("Final marketing eligibility check unavailable");
  return data;
}

export async function finishMarketingDelivery(db: any, businessId: string, id: string, status: "sent" | "failed" | "reconcile", providerId?: string) {
  const { error } = await db.from("marketing_deliveries").update({
    status, provider_id: providerId || null, updated_at: new Date().toISOString(),
  }).eq("business_id", businessId).eq("id", id).eq("status", "sending");
  if (error) throw new Error("Marketing delivery outcome needs reconciliation");
}

export function marketingDeliveryOutcome(ok: boolean, status: number, providerId?: string): "sent" | "failed" | "reconcile" {
  if (ok && providerId) return "sent";
  // Explicit validation/auth/rate-limit rejection is known not accepted. Everything
  // else (including timeout, malformed success and 5xx) needs reconciliation.
  return !ok && [400, 401, 403, 404, 422, 429].includes(status) ? "failed" : "reconcile";
}
