/**
 * Input sanitization & validation for API routes.
 *
 * Every public-facing handler should:
 *  1. parseBody() — enforces a 64 KB size limit and valid JSON object
 *  2. isUUID()    — validate all ID fields
 *  3. sanitize()  — trim, strip control chars, enforce max length
 *  4. isNum()     — validate numeric fields are finite and in range
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 64 * 1024;

/** Trim, strip dangerous control characters, enforce max length. */
export function sanitize(val: unknown, maxLen = 500): string {
  if (typeof val !== "string") return "";
  return val
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, maxLen);
}

/** Validate UUID v4 format. */
export function isUUID(val: unknown): val is string {
  return typeof val === "string" && UUID_RE.test(val);
}

/** Basic email format check (RFC-loose). */
export function isEmail(val: unknown): val is string {
  return typeof val === "string" && val.length <= 254 && EMAIL_RE.test(val);
}

/** Validate a number is finite and within [min, max]. */
export function isNum(val: unknown, min = -Infinity, max = Infinity): val is number {
  return typeof val === "number" && Number.isFinite(val) && val >= min && val <= max;
}

/** Check value is one of the allowed strings. */
export function isOneOf<T extends string>(val: unknown, options: readonly T[]): val is T {
  return typeof val === "string" && (options as readonly string[]).includes(val);
}

/** Sanitize a URL — must start with http(s)://. Returns "" for invalid. */
export function sanitizeUrl(val: unknown, maxLen = 2048): string {
  if (typeof val !== "string") return "";
  const s = val.trim().slice(0, maxLen);
  if (s && !/^https?:\/\//i.test(s)) return "";
  return s;
}

/** Parse + validate JSON body with size guard. */
export async function parseBody(
  req: Request,
  maxSize = MAX_BODY,
): Promise<{ data: Record<string, unknown>; error?: undefined } | { data: null; error: string }> {
  const cl = req.headers.get("content-length");
  if (cl && parseInt(cl, 10) > maxSize) {
    return { data: null, error: `Request body too large (max ${Math.round(maxSize / 1024)}KB)` };
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return { data: null, error: "Failed to read request body" };
  }

  if (text.length > maxSize) {
    return { data: null, error: `Request body too large (max ${Math.round(maxSize / 1024)}KB)` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { data: null, error: "Invalid JSON body" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { data: null, error: "Request body must be a JSON object" };
  }

  return { data: parsed as Record<string, unknown> };
}
