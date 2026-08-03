// Platform-billing state transitions on businesses.subscription_status.
//
// This is the enforcement linkage between platform_invoices and whether a
// tenant may trade. It is NOT a billing engine: invoices are still generated
// by hand, no cards are stored, nothing is auto-debited.
//
// The Node twin of restoreTenantIfSettled lives in app/lib/platform-billing.ts
// for the manual mark-paid route. Node and Deno cannot share a module, so the
// two are kept deliberately identical.

// An invoice that has been issued but not paid. DRAFT is not yet owed;
// PAID / PAID_MANUALLY are settled.
export const OUTSTANDING_INVOICE_STATUS = "SENT";

export async function hasOutstandingInvoices(supabase: any, businessId: string, exceptInvoiceId?: string): Promise<boolean | null> {
  let q = supabase
    .from("platform_invoices")
    .select("id")
    .eq("business_id", businessId)
    .eq("status", OUTSTANDING_INVOICE_STATUS)
    .limit(1);
  if (exceptInvoiceId) q = q.neq("id", exceptInvoiceId);

  const { data, error } = await q;
  // null means "could not tell" — callers must not treat that as "settled".
  if (error) {
    console.error("BILLING_OUTSTANDING_CHECK_ERR business=" + businessId + " err=" + error.message);
    return null;
  }
  return (data || []).length > 0;
}

/**
 * Called when an invoice is paid. Lifts a non-payment lockout, and only a
 * non-payment lockout.
 *
 * A tenant suspended by hand (suspension_reason MANUAL or null) stays
 * suspended: that was a human decision about the account, and a payment
 * landing must not silently reverse it. A PAUSED tenant is on a seasonal
 * break and is not locked out at all, so there is nothing to restore.
 *
 * Returns true only if the tenant was actually restored.
 */
export async function restoreTenantIfSettled(
  supabase: any,
  businessId: string,
  opts?: { exceptInvoiceId?: string; actorId?: string | null },
): Promise<boolean> {
  if (!businessId) return false;

  const { data: biz, error } = await supabase
    .from("businesses")
    .select("subscription_status, suspension_reason")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !biz) {
    console.error("BILLING_RESTORE_LOOKUP_ERR business=" + businessId + (error ? " err=" + error.message : " (no row)"));
    return false;
  }

  const status = String(biz.subscription_status || "").toUpperCase();
  const reason = biz.suspension_reason ?? null;
  const autoSuspended = status === "SUSPENDED" && reason === "NON_PAYMENT";
  if (status !== "PAST_DUE" && !autoSuspended) return false;

  // Fail closed: if we cannot confirm every other invoice is settled, leave the
  // tenant where they are rather than restoring on an unknown.
  const outstanding = await hasOutstandingInvoices(supabase, businessId, opts?.exceptInvoiceId);
  if (outstanding !== false) return false;

  const { error: updErr } = await supabase
    .from("businesses")
    .update({ subscription_status: "ACTIVE", suspension_reason: null })
    .eq("id", businessId);
  if (updErr) {
    console.error("BILLING_RESTORE_UPDATE_ERR business=" + businessId + " err=" + updErr.message);
    return false;
  }

  await supabase.from("audit_logs").insert({
    actor_id: opts?.actorId || null,
    business_id: businessId,
    action_type: "BILLING_RESTORED",
    target_entity: "businesses",
    target_id: businessId,
    before_state: { subscription_status: status, suspension_reason: reason },
    after_state: { subscription_status: "ACTIVE", suspension_reason: null },
    source: "billing-enforcement",
  });

  console.log("BILLING_RESTORED business=" + businessId + " from=" + status);
  return true;
}
