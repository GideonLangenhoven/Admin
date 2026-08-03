// Tenant trading status — the single definition of "is this operator allowed to
// take new business right now", used by the storefront payment gates and the
// marketing crons.
//
// The rule, and the reason the two halves differ:
//   New revenue-generating activity stops for a non-trading tenant.
//   Obligations to customers who already paid do not.
// So checkout and marketing sends are gated; trip reminders, waivers, refunds
// and cancellation notices for existing bookings are not. A paused operator
// with bookings on the books still owes those customers their reminders.
//
// businesses.subscription_status is canonical (see migration
// 20260803160000). The admin app has its own copy of this predicate in
// app/lib/api-auth.ts — Node and Deno cannot share a module, so the two are
// kept deliberately identical and both are covered by tests.

// PAST_DUE trades on purpose: it is a payment warning that shows a banner, not
// a lockout. Only SUSPENDED / PAUSED / CANCELLED stop trade.
const TRADING = new Set(["ACTIVE", "TRIAL", "PAST_DUE"]);

export function isTradingStatus(status?: string | null): boolean {
  return TRADING.has(String(status || "").toUpperCase());
}

export type SubscriptionState = {
  status: string;
  trading: boolean;
  suspensionReason: string | null;
};

// Fail closed: a tenant we cannot resolve does not get to take money. The two
// ways to land there are a deleted business or a broken DB call, so both are
// logged rather than silently denied.
export async function getSubscriptionState(supabase: any, businessId: string): Promise<SubscriptionState> {
  const { data, error } = await supabase
    .from("businesses")
    .select("subscription_status, suspension_reason")
    .eq("id", businessId)
    .maybeSingle();

  if (error || !data) {
    console.error("SUBSCRIPTION_" + (error ? "LOOKUP_FAILED" : "ROW_MISSING") + " business=" + businessId + (error ? " err=" + error.message : ""));
    return { status: "UNKNOWN", trading: false, suspensionReason: null };
  }

  const status = String(data.subscription_status || "").toUpperCase();
  return { status, trading: isTradingStatus(status), suspensionReason: data.suspension_reason ?? null };
}

// Batch variant for cron sweeps. Returns the subset of the given business ids
// that must NOT be sent new marketing this tick.
//
// Fails closed as a whole: if the lookup errors we cannot tell who is paused,
// so nobody gets marketing on this tick. A skipped tick is recoverable (the
// queue rows return to pending); emailing a paused operator's list on their
// behalf is not.
export async function nonTradingBusinessIds(supabase: any, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("businesses")
    .select("id, subscription_status")
    .in("id", unique);

  if (error) {
    console.error("SUBSCRIPTION_BATCH_LOOKUP_FAILED err=" + error.message);
    return new Set(unique);
  }

  const trading = new Set(
    (data || []).filter((b: any) => isTradingStatus(b.subscription_status)).map((b: any) => String(b.id)),
  );
  return new Set(unique.filter((id) => !trading.has(id)));
}

// Guard for the payment/booking-creation entry points. Returns null when the
// tenant may trade, or a ready-to-return Response when it may not.
//
// The customer-facing message never names the reason: a suspended operator's
// billing problem is not their customers' business. "Not currently taking
// bookings" is all a visitor sees, whether the operator paused for winter or
// stopped paying.
export async function blockIfNotTrading(
  supabase: any,
  businessId: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  const state = await getSubscriptionState(supabase, businessId);
  if (state.trading) return null;

  console.warn("TRADING_BLOCKED business=" + businessId + " status=" + state.status);
  return new Response(
    JSON.stringify({
      error: "This operator is not currently taking bookings.",
      code: "TENANT_NOT_TRADING",
    }),
    { status: 403, headers },
  );
}
