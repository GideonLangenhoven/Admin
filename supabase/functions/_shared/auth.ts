import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
var SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

export type AuthResult = {
  userId: string;
  businessId: string;
  role: string;
  isServiceRole: boolean;
};

/**
 * Validate the caller is either the service role (internal edge-fn call)
 * or an authenticated admin user.  Uses supabase.auth.getUser() which
 * supports all JWT algorithms — immune to the HS256/ES256 gateway issue.
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  var authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  var token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new Error("Missing authorization header");
  }

  if (token === SERVICE_ROLE_KEY) {
    return { userId: "service_role", businessId: "", role: "service_role", isServiceRole: true };
  }

  var supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  var { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    throw new Error("Invalid or expired token");
  }

  var { data: admin } = await supabase
    .from("admin_users")
    .select("business_id, role, suspended")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!admin || admin.suspended) {
    throw new Error("Not an active admin user");
  }

  return {
    userId: data.user.id,
    businessId: admin.business_id,
    role: admin.role,
    isServiceRole: false,
  };
}
