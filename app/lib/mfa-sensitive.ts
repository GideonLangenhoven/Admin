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

function recoveryState(status?: string | null): MfaInspection["recoveryState"] {
  const normalized = String(status || "").toLowerCase();
  return normalized === "pending" || normalized === "partial" || normalized === "completed" ? normalized : "none";
}

export async function inspectSensitiveMfa(req: Request, options: MfaOptions = {}): Promise<MfaInspection | MfaFailure> {
  const token = bearerToken(req);
  if (!token) return denied(401, "INVALID_SESSION", "Sign in again before continuing.");

  const client = serverClient();
  if (!client) return denied(503, "MFA_CHECK_UNAVAILABLE", "MFA verification is temporarily unavailable. Nothing was changed.");

  let userResult;
  try {
    userResult = await client.auth.getUser(token);
  } catch {
    return denied(503, "MFA_CHECK_UNAVAILABLE", "MFA verification is temporarily unavailable. Nothing was changed.");
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
  if (admin.read_only) return denied(403, "DEMO_READ_ONLY", "Demonstration accounts cannot configure MFA or change protected settings.");
  if (options.expectedActorId && admin.id !== options.expectedActorId) return denied(401, "ACTOR_MISMATCH", "The signed-in account changed. Sign in again.");
  if (options.allowedRoles && !options.allowedRoles.includes(admin.role)) return denied(403, "ROLE_FORBIDDEN", "This role cannot perform protected settings changes.");

  let assurance;
  try {
    assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel(token);
  } catch {
    return denied(503, "MFA_CHECK_UNAVAILABLE", "MFA verification is temporarily unavailable. Nothing was changed.");
  }
  if (assurance.error || !assurance.data) return denied(503, "MFA_CHECK_UNAVAILABLE", "MFA verification is temporarily unavailable. Nothing was changed.");

  const verifiedFactors = (user.factors || []).filter((factor) => factor.status === "verified" && factor.factor_type === "totp");
  const { data: recovery, error: recoveryError } = await client.from("mfa_recovery_state")
    .select("status, completed_at")
    .eq("admin_id", admin.id)
    .maybeSingle();
  if (recoveryError) return denied(503, "MFA_CHECK_UNAVAILABLE", "Recovery status could not be verified. Nothing was changed.");

  const state = recoveryState(recovery?.status);
  let reEnrollRequired = false;
  if (state === "completed") {
    const completedAt = Date.parse(recovery?.completed_at || "");
    const hasNewFactor = Number.isFinite(completedAt) && verifiedFactors.some((factor) => {
      const factorTime = Date.parse(factor.updated_at || factor.created_at || "");
      return Number.isFinite(factorTime) && factorTime > completedAt;
    });
    const methods = assurance.data.currentAuthenticationMethods || [];
    const hasNewChallenge = Number.isFinite(completedAt) && methods.some((method) => {
      if (typeof method === "string") return false;
      return String(method.method).includes("totp") && Number(method.timestamp) * 1000 > completedAt;
    });
    reEnrollRequired = !hasNewFactor || !hasNewChallenge;
  }

  return {
    ok: true,
    actor: { id: admin.id, userId: user.id, role: admin.role, businessId: admin.business_id },
    client,
    token,
    user,
    currentLevel: assurance.data.currentLevel,
    verifiedFactors,
    recoveryState: state,
    reEnrollRequired,
    ready: state !== "pending" && state !== "partial" && !reEnrollRequired && assurance.data.currentLevel === "aal2" && verifiedFactors.length > 0,
  };
}

export async function requireSensitiveMfa(req: Request, options: MfaOptions = {}): Promise<MfaInspection | MfaFailure> {
  const inspection = await inspectSensitiveMfa(req, options);
  if (!inspection.ok) return inspection;
  if (inspection.recoveryState === "pending" || inspection.recoveryState === "partial") {
    return denied(423, "MFA_RECOVERY_PENDING", "MFA recovery is still in progress. A Super Admin must finish it before protected settings can change.");
  }
  if (inspection.reEnrollRequired) {
    return denied(403, "MFA_REENROLL_REQUIRED", "Enroll a new authenticator and verify a fresh code before continuing.");
  }
  if (!inspection.verifiedFactors.length) {
    return denied(403, "MFA_FACTOR_MISSING", "Set up an authenticator before changing protected settings.");
  }
  if (inspection.currentLevel !== "aal2") {
    return denied(403, "MFA_REQUIRED", "Enter a current authenticator code before changing protected settings.");
  }
  return inspection;
}
