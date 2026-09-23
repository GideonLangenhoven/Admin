import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
// Hosted functions receive new API keys separately from the legacy JWT key.
// Admin servers and pg_net jobs may use either format during migration.
const serviceKeys = [SERVICE_ROLE_KEY, ...Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))]
  .filter((key): key is string => typeof key === "string" && key.length > 0);

export type AuthResult = {
  userId: string;
  businessId: string;
  role: string;
  isServiceRole: boolean;
  readOnly: boolean;
};

/**
 * Validate the caller is either the service role (internal edge-fn call)
 * or an authenticated admin user.  Uses supabase.auth.getUser() which
 * supports all JWT algorithms — immune to the HS256/ES256 gateway issue.
 */
export async function requireAuth(req: Request, options: { allowReadOnly?: boolean } = {}): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (serviceKeys.includes(token) || serviceKeys.includes(req.headers.get("apikey") || "")) {
    return { userId: "service_role", businessId: "", role: "service_role", isServiceRole: true, readOnly: false };
  }

  if (!token) {
    throw new Error("Missing authorization header");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    throw new Error("Invalid or expired token");
  }

  const { data: admin } = await supabase
    .from("admin_users")
    .select("business_id, role, suspended, read_only")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!admin || admin.suspended ||
      !["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"].includes(admin.role) ||
      (!admin.business_id && admin.role !== "SUPER_ADMIN")) {
    throw new Error("Not an active admin user");
  }
  // Edge functions run with the service role and can send messages or move
  // money before a database trigger gets a chance to reject a write.
  if (admin.read_only && !options.allowReadOnly) throw new Error("This demonstration account is read-only");

  return {
    userId: data.user.id,
    businessId: admin.business_id,
    role: admin.role,
    isServiceRole: false,
    readOnly: admin.read_only === true,
  };
}

export function canAccessBusiness(auth: AuthResult, businessId: string): boolean {
  return Boolean(businessId) && (auth.isServiceRole || auth.role === "SUPER_ADMIN" || auth.businessId === businessId);
}
