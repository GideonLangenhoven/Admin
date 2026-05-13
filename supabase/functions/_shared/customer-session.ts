// Stateless customer-session tokens for /my-bookings.
//
// After a successful OTP verification we issue a long-lived (30-day) token
// that the booking site stores in localStorage. The token is an HMAC-signed
// claim of {email, business_id, expires_at} — no DB row required, so it
// scales freely and survives function restarts. The HMAC is over the
// project's SERVICE_ROLE_KEY (or an explicit CUSTOMER_SESSION_SECRET if
// the operator wants to rotate sessions independently from the service
// role key).
//
// Token format (base64url):
//   payload = "<email>|<business_id>|<exp_ms>"
//   token   = base64url(payload) + "." + base64url(hmac_sha256(secret, payload))
//
// Validation recomputes the HMAC and rejects expired tokens. Single-line
// constant-time comparison via subtle.timingSafeEqual.

const TOKEN_VERSION = "v1";
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  return (
    Deno.env.get("CUSTOMER_SESSION_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""
  );
}

function b64url(bytes: Uint8Array | string): string {
  const buf =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function issueCustomerSession(input: {
  email: string;
  businessId: string;
  ttlMs?: number;
}): Promise<{ token: string; expiresAt: number }> {
  const secret = getSecret();
  if (!secret) throw new Error("CUSTOMER_SESSION_SECRET missing");
  const expiresAt = Date.now() + (input.ttlMs || CUSTOMER_SESSION_TTL_MS);
  const payload = `${TOKEN_VERSION}|${input.email.toLowerCase()}|${input.businessId}|${expiresAt}`;
  const sig = await hmacSha256(secret, payload);
  const token = `${b64url(payload)}.${b64url(sig)}`;
  return { token, expiresAt };
}

export async function verifyCustomerSession(token: string): Promise<{
  valid: boolean;
  email?: string;
  businessId?: string;
  expiresAt?: number;
  reason?: string;
}> {
  if (!token || typeof token !== "string") return { valid: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  let payload: string;
  try {
    payload = new TextDecoder().decode(b64urlDecode(parts[0]));
  } catch {
    return { valid: false, reason: "decode_error" };
  }
  const fields = payload.split("|");
  if (fields.length !== 4 || fields[0] !== TOKEN_VERSION) {
    return { valid: false, reason: "version_or_shape" };
  }
  const [, email, businessId, expStr] = fields;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt)) return { valid: false, reason: "exp_invalid" };
  if (Date.now() >= expiresAt) return { valid: false, reason: "expired" };

  const secret = getSecret();
  if (!secret) return { valid: false, reason: "no_secret" };
  const expectedSig = await hmacSha256(secret, payload);
  let providedSig: Uint8Array;
  try {
    providedSig = b64urlDecode(parts[1]);
  } catch {
    return { valid: false, reason: "sig_decode" };
  }
  if (!timingSafeEqual(expectedSig, providedSig)) {
    return { valid: false, reason: "sig_mismatch" };
  }
  return { valid: true, email, businessId, expiresAt };
}
