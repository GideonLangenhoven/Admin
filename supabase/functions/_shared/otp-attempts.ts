export const OTP_TTL_MS = 15 * 60 * 1000;
export const OTP_SEND_WINDOW_MINUTES = 10;
export const OTP_EMAIL_SEND_LIMIT = 3;
export const OTP_IP_SEND_LIMIT = 10;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
export const OTP_LOCK_MINUTES = 15;

export type OtpAttemptRow = {
  token_hash: string;
  business_id: string;
  email: string;
  phone_tail?: string | null;
  code_hash?: string | null;
  attempts: number;
  locked_until?: string | null;
  expires_at: string;
  purpose?: string | null;
};

export type VerifyTrackedOtpResult = {
  valid: boolean;
  status: number;
  error?: string;
  email?: string;
  phoneTail?: string;
  purpose?: string;
};

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeOtpCode(code: string) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

export function generateOtpCode() {
  const codeNum = crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
  return String(codeNum);
}

export function createOpaqueOtpToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getClientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "";
}

export async function sha256Hex(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(sig);
}

export async function hashOtpCode(secret: string, token: string, code: string) {
  return hmacHex(secret, token + "|" + normalizeOtpCode(code));
}

export async function createLegacyOtpToken(
  secret: string,
  email: string,
  phoneTail: string,
  code: string,
  expiresTs: number,
) {
  const payload = [email, phoneTail, code, expiresTs].join("|");
  const sig = await hmacHex(secret, payload);
  return btoa(payload + "|" + sig);
}

export async function verifyLegacyOtpToken(secret: string, token: string, userCode: string): Promise<VerifyTrackedOtpResult> {
  try {
    const raw = atob(token);
    const parts = raw.split("|");
    if (parts.length !== 5) return { valid: false, status: 401, error: "Invalid token" };

    const [email, phoneTail, code, expiresStr, sig] = parts;
    const expiresTs = Number(expiresStr);
    if (!Number.isFinite(expiresTs) || Date.now() > expiresTs) {
      return { valid: false, status: 401, error: "Code expired. Please request a new one." };
    }

    const payload = [email, phoneTail, code, expiresStr].join("|");
    const expectedSig = await hmacHex(secret, payload);
    if (sig !== expectedSig) return { valid: false, status: 401, error: "Invalid token" };
    if (normalizeOtpCode(userCode) !== code) {
      return { valid: false, status: 401, error: "Incorrect code. Please try again." };
    }

    return { valid: true, status: 200, email, phoneTail };
  } catch {
    return { valid: false, status: 401, error: "Invalid token" };
  }
}

export function secondsUntil(isoDate: string) {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - Date.now()) / 1000));
}

export async function countRecentOtpAttempts(
  supabase: SupabaseLike,
  column: "email" | "ip_address",
  value: string,
  windowMinutes = OTP_SEND_WINDOW_MINUTES,
) {
  if (!value) return 0;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("otp_attempts")
    .select("*", { count: "exact", head: true })
    .eq(column, value)
    .gte("created_at", windowStart);
  if (error) throw new Error("OTP rate-limit lookup failed: " + error.message);
  return count || 0;
}

export async function insertOtpAttempt(
  supabase: SupabaseLike,
  secret: string,
  input: {
    token: string;
    businessId: string;
    email: string;
    phoneTail?: string;
    code: string;
    expiresTs: number;
    ipAddress?: string;
    purpose: string;
  },
) {
  const tokenHash = await sha256Hex(input.token);
  const codeHash = await hashOtpCode(secret, input.token, input.code);
  const { error } = await supabase.from("otp_attempts").insert({
    token_hash: tokenHash,
    business_id: input.businessId,
    email: input.email,
    phone_tail: input.phoneTail || null,
    code_hash: codeHash,
    ip_address: input.ipAddress || null,
    purpose: input.purpose,
    attempts: 0,
    expires_at: new Date(input.expiresTs).toISOString(),
  });
  if (error) throw new Error("OTP attempt insert failed: " + error.message);
  return tokenHash;
}

export async function verifyTrackedOtp(
  supabase: SupabaseLike,
  secret: string,
  token: string,
  userCode: string,
) {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase
    .from("otp_attempts")
    .select("token_hash, business_id, email, phone_tail, code_hash, attempts, locked_until, expires_at, purpose")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error("OTP attempt lookup failed: " + error.message);

  if (!data) {
    return verifyLegacyOtpToken(secret, token, userCode);
  }

  const attempt = data as OtpAttemptRow;
  if (new Date(attempt.expires_at).getTime() < Date.now()) {
    await supabase.from("otp_attempts").delete().eq("token_hash", tokenHash);
    return { valid: false, status: 401, error: "Code expired. Please request a new one." };
  }

  if (attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
    const seconds = secondsUntil(attempt.locked_until);
    return {
      valid: false,
      status: 429,
      error: "Too many incorrect codes. Please request a new code in " + seconds + " seconds.",
    };
  }

  const submittedHash = await hashOtpCode(secret, token, userCode);
  if (!attempt.code_hash || submittedHash !== attempt.code_hash) {
    await supabase.rpc("bt_record_otp_failed_attempt", {
      p_token_hash: tokenHash,
      p_max_attempts: OTP_MAX_VERIFY_ATTEMPTS,
      p_lock_minutes: OTP_LOCK_MINUTES,
    });
    return { valid: false, status: 401, error: "Incorrect code. Please try again." };
  }

  await supabase.from("otp_attempts").delete().eq("token_hash", tokenHash);
  return {
    valid: true,
    status: 200,
    email: attempt.email,
    phoneTail: attempt.phone_tail || "",
    purpose: attempt.purpose || "my_bookings",
  };
}
