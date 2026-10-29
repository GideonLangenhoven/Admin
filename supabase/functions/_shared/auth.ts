import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
// Hosted functions receive new API keys separately from the legacy JWT key.
// Admin servers and pg_net jobs may use either format during migration.
const serviceKeys = [SERVICE_ROLE_KEY, ...Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))]
  .filter((key): key is string => typeof key === "string" && key.length > 0);

// Roles that must hold an AAL2 (TOTP-verified) session, e.g. "SUPER_ADMIN,MAIN_ADMIN". Empty = not enforced.
// Set it only after those admins have enrolled a factor, or they lose access to privileged functions.
const aal2Roles = new Set((Deno.env.get("ENFORCE_ADMIN_AAL2_ROLES") || "").split(",").map((r) => r.trim()).filter(Boolean));

// The token has already been validated by auth.getUser(); this only reads its assurance-level claim.
function sessionAal(token: string): string {
  try {
    return String(JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || "");
  } catch {
    return "";
  }
}

export type AuthResult = {
  userId: string;
  businessId: string;
  role: string;
  isServiceRole: boolean;
  readOnly: boolean;
  /** Service-key callers: the x-caller-function header value (internal callers set it), else "unspecified". */
  caller?: string;
};

/**
 * kind lets a caller tell "not an admin" (rebook-booking then tries the booking-owner path, using `user`)
 * from "bad or missing token". `message` is safe to return to the client.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: "missing" | "invalid" | "not_admin" | "read_only" | "unavailable" | "mfa_required",
    readonly user?: { id: string; email?: string | null; email_confirmed_at?: string | null },
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// Compares over the secret's length with no early exit, so response time does not reveal how much of a guess matched.
export function safeEqual(candidate: string, secret: string): boolean {
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

export function isServiceKey(candidate: string): boolean {
  if (!candidate) return false;
  let match = false;
  for (const key of serviceKeys) match = safeEqual(candidate, key) || match; // visit every key
  return match;
}

export function bearerToken(req: Request): string {
  return (req.headers.get("authorization") || req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Validate the caller is either the service role (internal edge-fn call)
 * or an authenticated admin user.  Uses supabase.auth.getUser() which
 * supports all JWT algorithms — immune to the HS256/ES256 gateway issue.
 */
export async function requireAuth(req: Request, options: { allowReadOnly?: boolean } = {}): Promise<AuthResult> {
  const token = bearerToken(req);

  if (isServiceKey(token) || isServiceKey(req.headers.get("apikey") || "")) {
    return {
      userId: "service_role", businessId: "", role: "service_role", isServiceRole: true, readOnly: false,
      caller: (req.headers.get("x-caller-function") || "").trim().slice(0, 64) || "unspecified",
    };
  }

  if (!token) {
    throw new AuthError("Missing authorization header", "missing");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    throw new AuthError("Invalid or expired token", "invalid");
  }

  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("business_id, role, suspended, read_only")
    .eq("user_id", data.user.id)
    .maybeSingle();

  // A failed lookup is not "not an admin": deny, but let callers tell a transient outage from a permission failure.
  if (adminError) throw new AuthError("Admin access could not be verified", "unavailable", data.user);
  if (!admin || admin.suspended || (!admin.business_id && admin.role !== "SUPER_ADMIN")) {
    throw new AuthError("Not an active admin user", "not_admin", data.user);
  }
  // Edge functions run with the service role and can send messages or move
  // money before a database trigger gets a chance to reject a write.
  if (admin.read_only && !options.allowReadOnly) throw new AuthError("This demonstration account is read-only", "read_only", data.user);
  if (aal2Roles.has(admin.role) && sessionAal(token) !== "aal2") throw new AuthError("Multi-factor authentication required", "mfa_required", data.user);

  return {
    userId: data.user.id,
    businessId: admin.business_id,
    role: admin.role,
    isServiceRole: false,
    readOnly: admin.read_only === true,
  };
}

// Exact role match only: a role that merely contains "super" is not a super admin.
export function canAccessBusiness(auth: AuthResult, businessId: string): boolean {
  return Boolean(businessId) && (auth.isServiceRole || auth.role === "SUPER_ADMIN" || auth.businessId === businessId);
}

/**
 * Record a service-key call to a privileged function so misuse of the backend credential is visible.
 * No-op for admin/customer callers. Best effort: an audit-write failure is logged, not turned into an outage.
 */
export async function auditServiceCall(
  db: { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }> } },
  auth: AuthResult,
  fn: string,
  businessId: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!auth.isServiceRole) return;
  try {
    const { error } = await db.from("logs").insert({
      business_id: businessId || null,
      event: "SERVICE_KEY_CALL",
      payload: { function: fn, caller: auth.caller || "unspecified", ...extra },
    });
    if (error) console.error("SERVICE_KEY_CALL audit insert failed:", fn, error);
  } catch (e) {
    console.error("SERVICE_KEY_CALL audit insert threw:", fn, e);
  }
}
