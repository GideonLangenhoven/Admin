import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const KNOWN_ADMIN_ROLES = ["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"];

export type MfaFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type MfaActor = {
  id: string;
  userId: string;
  role: string;
  businessId: string;
};

export type MfaInspection = {
  ok: true;
  actor: MfaActor;
  client: SupabaseClient;
  token: string;
  user: User;
  currentLevel: "aal1" | "aal2" | null;
  verifiedFactors: NonNullable<User["factors"]>;
  recoveryState: "none" | "pending" | "partial" | "completed";
  reEnrollRequired: boolean;
  ready: boolean;
};

type MfaOptions = {
  allowedRoles?: string[];
  expectedActorId?: string;
};

function denied(status: number, code: string, message: string): MfaFailure {
  return { ok: false, status, code, message };
}

function bearerToken(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
  return match?.[1] || "";
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.length < 40) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function inspectSensitiveMfa(req: Request, options: MfaOptions = {}): Promise<MfaInspection | MfaFailure> {
  const token = bearerToken(req);
  if (!token) return denied(401, "INVALID_SESSION", "Sign in again before continuing.");

  const client = serverClient();
  if (!client) return denied(503, "MFA_CHECK_UNAVAILABLE", "Account verification is temporarily unavailable. Nothing was changed.");

  let userResult;
  try {
    userResult = await client.auth.getUser(token);
  } catch {
    return denied(503, "MFA_CHECK_UNAVAILABLE", "Account verification is temporarily unavailable. Nothing was changed.");
  }
  const user = userResult.data.user;
  if (userResult.error || !user) return denied(401, "INVALID_SESSION", "Your session could not be verified. Sign in again.");

  const { data: admin, error: adminError } = await client.from("admin_users")
    .select("id, user_id, role, business_id, suspended, read_only")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminError) return denied(503, "MFA_CHECK_UNAVAILABLE", "Account verification is temporarily unavailable. Nothing was changed.");
  if (!admin || !KNOWN_ADMIN_ROLES.includes(String(admin.role))) return denied(403, "ROLE_FORBIDDEN", "This account cannot perform protected settings changes.");
  if (admin.suspended) return denied(403, "ACCOUNT_INACTIVE", "This account is suspended.");
  if (admin.read_only) return denied(403, "DEMO_READ_ONLY", "Demonstration accounts cannot change protected settings.");
  if (options.expectedActorId && admin.id !== options.expectedActorId) return denied(401, "ACTOR_MISMATCH", "The signed-in account changed. Sign in again.");
  if (options.allowedRoles && !options.allowedRoles.includes(admin.role)) return denied(403, "ROLE_FORBIDDEN", "This role cannot perform protected settings changes.");

  return {
    ok: true,
    actor: { id: admin.id, userId: user.id, role: admin.role, businessId: admin.business_id },
    client,
    token,
    user,
    currentLevel: null,
    verifiedFactors: [],
    recoveryState: "none",
    reEnrollRequired: false,
    ready: true,
  };
}

// Keep the existing server callers and cached status clients compatible after MFA removal.
export const requireSensitiveMfa = inspectSensitiveMfa;
