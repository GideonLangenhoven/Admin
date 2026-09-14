// Trust-boundary helpers for the onboarding wizard.
//
// These live outside index.ts so they can be exercised directly by
// onboarding-guards.test.ts. They are the parts an anonymous caller can push
// on: what they are allowed to write, and what URL we are willing to fetch on
// their behalf.

// Columns the wizard may write, per step. Anything absent is silently dropped.
// The point is what is NOT here: subscription_status, subdomain, the derived
// booking URLs, and every *_encrypted credential column stay unreachable.
export const STEP_COLUMNS: Record<string, string[]> = {
  identity: [
    "name", "business_name", "business_tagline", "business_address",
    "timezone", "currency", "google_place_id", "social_google_reviews",
    "operator_email", "notification_email",
  ],
  branding: [
    "logo_url", "color_main", "color_secondary", "color_cta",
    "hero_eyebrow", "hero_title", "hero_subtitle",
  ],
  operations: [
    "meeting_point", "meeting_point_address", "directions",
    "arrival_instructions", "what_to_bring", "what_to_wear",
    "activity_noun", "activity_verb_past",
  ],
  refunds: ["refund_policy_tiers", "refund_policy_text"],
  faqs: ["faq_json", "ai_system_prompt"],
};

export function pickColumns(step: string, data: Record<string, unknown>) {
  const allowed = STEP_COLUMNS[step] || [];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data) out[key] = data[key];
  }
  return out;
}

// Refund tiers decide real money back to a customer, so they are rebuilt from
// scratch here rather than trusted: coerced to numbers, clamped, and sorted
// descending by hours_before, which is the order calculate_refund_percent walks.
export function normaliseRefundTiers(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  const tiers = raw
    .map((t: any) => ({
      hours_before: Math.max(0, Math.round(Number(t?.hours_before) || 0)),
      refund_percent: Math.min(100, Math.max(0, Math.round(Number(t?.refund_percent) || 0))),
    }))
    .sort((a, b) => b.hours_before - a.hours_before);
  return tiers.length ? tiers : null;
}

// ── SSRF guard ─────────────────────────────────────────────────────────────
// The client hands us a URL and we fetch it server-side from inside the
// cluster, so anything that resolves onto a private network is refused.
const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|198\.1[89]\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export function isPrivateAddress(addr: string) {
  const a = String(addr || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (PRIVATE_V4.test(a)) return true;
  if (a === "::1" || a === "::" || a === "0.0.0.0") return true;
  if (a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd")) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return PRIVATE_V4.test(mapped[1]);
  return false;
}

export function isBlockedHost(hostname: string) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return isPrivateAddress(host);
}

// Parses and vets a user-supplied URL. Throws with a message safe to show the
// client; the caller still has to check what the hostname resolves to.
// Matches a real scheme prefix like "http:", "file:" or "javascript:". Dots are
// deliberately excluded so "www.example.co.za:8080" reads as a host and port
// rather than as a scheme.
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-]*:/;

export function parsePublicUrl(raw: string): URL {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("That does not look like a valid URL.");

  // People type "www.capeweb.co.za", not "https://www.capeweb.co.za", so a bare
  // domain gets https rather than a rejection. Input that already carries a
  // scheme is left exactly as typed, so file:, data: and javascript: still fall
  // through to the allowlist below instead of being rewritten into something
  // fetchable.
  const candidate = SCHEME_RE.test(trimmed) ? trimmed : "https://" + trimmed.replace(/^\/+/, "");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error("That host is not reachable.");
  }
  return url;
}
