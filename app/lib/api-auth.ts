import { createClient } from "@supabase/supabase-js";
export { isPrivilegedRole, canManageAdmin } from "./role-utils";

export type CallerAdmin = {
  id: string;
  role: string;
  business_id: string;
};

export async function getCallerAdmin(
  req: Request,
  opts?: { skipSubscriptionCheck?: boolean },
): Promise<CallerAdmin | null> {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40) return null;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: adminRow } = await admin
    .from("admin_users")
    .select("id, role, business_id, suspended, read_only")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!adminRow || adminRow.suspended) return null;
  // Shared demo credentials may browse GET-backed dashboard data, but can
  // never use a service-role API route to mutate data or contact customers.
  if (adminRow.read_only && req.method !== "GET") return null;

  // A browser-selected tenant is a target, never proof of permission. Regular
  // operators cannot pivot away from the business bound to their identity.
  const target = req.headers.get("x-admin-business-id")?.trim();
  if (target && target !== adminRow.business_id) {
    if (adminRow.role !== "SUPER_ADMIN" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) return null;
    const { data: business, error: businessError } = await admin.from("businesses")
      .select("id").eq("id", target).maybeSingle();
    if (businessError || !business) return null;
    adminRow.business_id = business.id;
  }

  // A8: a tenant whose subscription is suspended/cancelled loses privileged API
  // access — enforced server-side here so it can't be bypassed by hitting the
  // API directly (the client-side gate alone was security-theatre). SUPER_ADMIN
  // is platform staff and exempt; billing routes pass skipSubscriptionCheck so a
  // suspended tenant can still reach the billing surface to reactivate. A tenant
  // that cannot be resolved is denied (see requireActiveSubscription).
  if (!opts?.skipSubscriptionCheck && adminRow.role !== "SUPER_ADMIN") {
    const sub = await requireActiveSubscription(adminRow.business_id);
    if (!sub.active) return null;
  }

  return { id: adminRow.id, role: adminRow.role, business_id: adminRow.business_id };
}

// Which subscription states keep privileged API access. PAST_DUE is deliberately
// permissive: it is a payment warning, not a lockout. Everything else — SUSPENDED,
// PAUSED, CANCELLED, INACTIVE, and any value this function has never heard of —
// is denied, so a new status can never silently grant access.
export function isTradingStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toUpperCase();
  return s === "ACTIVE" || s === "TRIAL" || s === "PAST_DUE";
}

export async function requireActiveSubscription(businessId: string): Promise<{ active: boolean; status: string }> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false } });

  // businesses.subscription_status is canonical. It is NOT NULL, populated for
  // every tenant, and is the column AuthGate, AppShell, super-admin and settings
  // already read and write. The subscriptions table has a row for only a
  // fraction of tenants, so gating on it meant `?? "ACTIVE"` handed full access
  // to every tenant that had never been given one.
  const { data, error } = await db.from("businesses")
    .select("subscription_status")
    .eq("id", businessId)
    .maybeSingle();

  if (error || !data) {
    // Fail closed. The only two routes here are a deleted business or a broken
    // DB call, so make it impossible to miss rather than silently denying.
    console.error(JSON.stringify({
      level: "error",
      code: error ? "SUBSCRIPTION_LOOKUP_FAILED" : "SUBSCRIPTION_ROW_MISSING",
      business_id: businessId,
      detail: error?.message ?? null,
    }));
    return { active: false, status: "UNKNOWN" };
  }

  const status = String(data.subscription_status || "").toUpperCase();
  return { active: isTradingStatus(status), status };
}
