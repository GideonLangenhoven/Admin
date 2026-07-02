import { createClient } from "@supabase/supabase-js";

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
    .select("id, role, business_id, suspended")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!adminRow || adminRow.suspended) return null;

  // A8: a tenant whose subscription is suspended/cancelled loses privileged API
  // access — enforced server-side here so it can't be bypassed by hitting the
  // API directly (the client-side gate alone was security-theatre). SUPER_ADMIN
  // is platform staff and exempt; billing routes pass skipSubscriptionCheck so a
  // suspended tenant can still reach the billing surface to reactivate. Tenants
  // with no subscription row are treated as active (see requireActiveSubscription).
  if (!opts?.skipSubscriptionCheck && adminRow.role !== "SUPER_ADMIN") {
    const sub = await requireActiveSubscription(adminRow.business_id);
    if (!sub.active) return null;
  }

  return { id: adminRow.id, role: adminRow.role, business_id: adminRow.business_id };
}

export function isPrivilegedRole(role: string): boolean {
  return role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
}

export async function requireActiveSubscription(businessId: string): Promise<{ active: boolean; status: string }> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data } = await db.from("subscriptions")
    .select("status")
    .eq("business_id", businessId)
    .maybeSingle();

  const status = data?.status ?? "ACTIVE";
  return { active: status === "ACTIVE" || status === "TRIAL", status };
}
