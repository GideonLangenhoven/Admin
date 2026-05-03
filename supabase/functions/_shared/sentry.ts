// Lightweight Sentry envelope-API client for Deno edge functions.
// No SDK dependency — just one fire-and-forget POST per exception.

const DSN = Deno.env.get("SENTRY_DSN") || "";
const ENV = Deno.env.get("SUPABASE_ENV") || Deno.env.get("ENVIRONMENT") || "production";

let parsed: { host: string; projectId: string; publicKey: string } | null = null;
function parseDsn() {
  if (parsed || !DSN) return parsed;
  try {
    const url = new URL(DSN);
    parsed = {
      host: url.host,
      projectId: url.pathname.replace(/^\//, ""),
      publicKey: url.username,
    };
  } catch (_) {
    parsed = null;
  }
  return parsed;
}

function envelopeUrl() {
  const p = parseDsn();
  if (!p) return null;
  return `https://${p.host}/api/${p.projectId}/envelope/`;
}

function authHeader() {
  const p = parseDsn();
  if (!p) return "";
  return `Sentry sentry_version=7, sentry_key=${p.publicKey}, sentry_client=capekayak-edge/1.0`;
}

function uuidNoDashes() {
  return crypto.randomUUID().replace(/-/g, "");
}

type ExtraContext = {
  function?: string;
  request?: { method: string; url: string; headers?: Record<string, string> };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; business_id?: string };
};

function stripPii(headers?: Record<string, string>) {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(headers)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "apikey" || lk === "x-supabase-auth") continue;
    out[k] = headers[k];
  }
  return out;
}

export function captureException(err: unknown, ctx: ExtraContext = {}) {
  const url = envelopeUrl();
  if (!url) return;

  const eventId = uuidNoDashes();
  const errObj = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: ENV,
    server_name: ctx.function || "edge-function",
    tags: {
      runtime: "deno",
      "function.name": ctx.function || "unknown",
      ...(ctx.tags || {}),
    },
    user: ctx.user,
    request: ctx.request
      ? { ...ctx.request, headers: stripPii(ctx.request.headers) }
      : undefined,
    extra: ctx.extra,
    exception: {
      values: [{
        type: errObj.name || "Error",
        value: errObj.message || String(err),
        stacktrace: errObj.stack ? { frames: parseStack(errObj.stack) } : undefined,
      }],
    },
  };

  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) + "\n" +
    JSON.stringify({ type: "event" }) + "\n" +
    JSON.stringify(event) + "\n";

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": authHeader(),
    },
    body: envelope,
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

function parseStack(stack: string) {
  return stack
    .split("\n")
    .filter((l) => l.trim().startsWith("at "))
    .map((l) => {
      const m = l.match(/at (.+?) \((.+?):(\d+):(\d+)\)/) || l.match(/at (.+?):(\d+):(\d+)/);
      if (!m) return { function: l.trim() };
      return m.length === 5
        ? { function: m[1], filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: true }
        : { filename: m[1], lineno: Number(m[2]), colno: Number(m[3]), in_app: true };
    });
}

export function withSentry<T extends (req: Request) => Response | Promise<Response>>(
  functionName: string,
  handler: T,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      const reqHeaders: Record<string, string> = {};
      req.headers.forEach((v, k) => { reqHeaders[k] = v; });
      captureException(err, {
        function: functionName,
        request: { method: req.method, url: req.url, headers: reqHeaders },
      });
      console.error(`[${functionName}] uncaught error:`, err);
      return new Response(
        JSON.stringify({ error: "Internal server error", reference: functionName }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
