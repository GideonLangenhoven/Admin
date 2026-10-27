// A payment capability only opens checkout; it cannot read guest details or sign a waiver.
const encoder = new TextEncoder();
async function key() {
  const secret = Deno.env.get("BOOKING_SUCCESS_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Payment link signing key missing");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const payload = (booking: string, business: string, expires: string) => encoder.encode(`booking-payment:v1|${booking}|${business}|${expires}`);
export async function paymentDeadlineUrl(base: string, booking: string, business: string, deadline: string) {
  const expires = String(Date.parse(deadline));
  if (!Number.isFinite(Number(expires)) || Number(expires) <= Date.now() || !booking || !business || /\|/.test(booking + business)) throw new Error("Payment deadline unavailable or expired");
  const signature = await crypto.subtle.sign("HMAC", await key(), payload(booking, business, expires));
  const token = expires + "." + btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = new URL(base.replace(/\/$/, "") + "/functions/v1/booking-payment");
  url.search = new URLSearchParams({ booking, business, token }).toString();
  return url.toString();
}
export async function verifyPaymentDeadlineToken(token: string, booking: string, business: string) {
  if (!booking || !business || /\|/.test(booking + business) || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expires, signature] = token.split(".");
  if (Date.now() >= Number(expires)) return false;
  const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "="), c => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", await key(), bytes, payload(booking, business, expires));
}
