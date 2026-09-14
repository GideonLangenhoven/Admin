// Read-only confirmation capability. Separate from OTP sessions and waiver
// tokens: changing a waiver after adding guests must not invalidate checkout.
export const BOOKING_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

async function signingKey() {
  const secret = Deno.env.get("BOOKING_SUCCESS_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Booking confirmation signing key missing");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function payload(bookingId: string, businessId: string, expires: string) {
  // Domain separation prevents these tokens being used as customer sessions.
  return encoder.encode(`booking-success:v1|${bookingId}|${businessId}|${expires}`);
}

export async function issueBookingSuccessToken(bookingId: string, businessId: string): Promise<string> {
  if (!bookingId || !businessId || bookingId.includes("|") || businessId.includes("|")) throw new Error("Booking confirmation identity missing");
  const expires = String(Date.now() + BOOKING_SUCCESS_TTL_MS);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), payload(bookingId, businessId, expires));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${expires}.${encoded}`;
}

export async function verifyBookingSuccessToken(token: string, bookingId: string, businessId: string): Promise<boolean> {
  if (!bookingId || !businessId || bookingId.includes("|") || businessId.includes("|")) return false;
  if (!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expires, encoded] = token.split(".");
  if (Date.now() >= Number(expires)) return false;
  const signature = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "="), c => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", await signingKey(), signature, payload(bookingId, businessId, expires));
}

export async function bookingSuccessUrl(base: string, bookingId: string, businessId: string, amendmentId?: string): Promise<string> {
  const url = new URL(base);
  url.searchParams.set("ref", bookingId);
  // Fragments stay out of HTTP requests, server access logs and Referer headers.
  const fragment = new URLSearchParams({ token: await issueBookingSuccessToken(bookingId, businessId) });
  if (amendmentId) fragment.set("amendment", amendmentId);
  url.hash = fragment.toString();
  return url.toString();
}
