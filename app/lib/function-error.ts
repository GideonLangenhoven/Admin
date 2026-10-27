// Edge functions answer failures with { error, reason? }. supabase-js turns any
// non-2xx into "Edge Function returned a non-2xx status code" and keeps the
// body on error.context, so read it there. Returns null on success, otherwise
// a message safe to show an operator: error codes and database text are
// replaced by the fallback, and the detail goes to the console for support.
const FALLBACK = "Something went wrong. Please try again.";
// ponytail: pattern match on known Postgres phrasing; a server-side error code
// per function is the stricter fix if raw text still slips through.
const RAW_DB_TEXT = /violates|relation "|column "|syntax error|permission denied|row-level security|duplicate key|null value/i;

export async function functionError(
  res: { data?: unknown; error?: unknown },
  fallback = FALLBACK,
): Promise<string | null> {
  let body = res.data as Record<string, unknown> | null | undefined;
  const context = (res.error as { context?: unknown } | null | undefined)?.context;
  if (context instanceof Response) body = await context.clone().json().catch(() => null);
  if (!res.error && !body?.error && body?.ok !== false) return null;
  console.error("[edge function error]", res.error, body);
  const text = [body?.reason, body?.message, body?.error].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (!text || /^[A-Z0-9_]+$/.test(text) || RAW_DB_TEXT.test(text)) return fallback;
  return text;
}
