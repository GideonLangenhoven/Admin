// Lightweight Sentry envelope-API client for Deno edge functions.
// No SDK dependency. Await a bounded delivery before the worker exits.

const DSN = (Deno.env.get("SENTRY_DSN") || "").trim();
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
  return Object.fromEntries(Object.entries(headers).filter(([key]) => ["content-type","user-agent"].includes(key.toLowerCase())));
}
function safeUrl(value: string) {
  try { const url = new URL(value); return url.origin + url.pathname; } catch { return undefined; }
}

export async function captureException(err: unknown, ctx: ExtraContext = {}) {
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
      app: "edge",
      "function.name": ctx.function || "unknown",
      ...(ctx.tags || {}),
    },
    user: ctx.user,
    request: ctx.request
      ? { method: ctx.request.method, url: safeUrl(ctx.request.url), headers: stripPii(ctx.request.headers) }
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

  await fetch(url, {
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


export async function captureCheckIn(slug: string, status: "in_progress" | "ok" | "error", checkInId = uuidNoDashes()) {
  const url = envelopeUrl();
  if (!url) return checkInId;
  const payload = { check_in_id: checkInId, monitor_slug: slug, status, environment: ENV };
  const envelope = JSON.stringify({sent_at:new Date().toISOString()})+"\n"+JSON.stringify({type:"check_in"})+"\n"+JSON.stringify(payload)+"\n";
  await fetch(url, {
    method:"POST", headers:{"Content-Type":"application/x-sentry-envelope","X-Sentry-Auth":authHeader()},
    body:envelope,signal:AbortSignal.timeout(2000),
  }).catch(()=>{});
  return checkInId;
}

export function withSentry<T extends (req: Request) => Response | Promise<Response>>(
  functionName: string,
  handler: T,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      const response = await handler(req);
      let failed = response.status >= 500;
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const body = await response.clone().json().catch(() => null);
        failed = body?.ok === false || body?.success === false
          || (typeof body?.errors === "number" && body.errors > 0)
          || (Array.isArray(body?.errors) && body.errors.length > 0)
          || (typeof body?.failed === "number" && body.failed > 0);
      }
      if (failed) await captureException(new Error("Operation returned a failure"), {
        function: functionName, tags: { "http.status_code": String(response.status) },
        request: { method: req.method, url: req.url },
      });
      return response;
    } catch (err) {
      const reqHeaders: Record<string, string> = {};
      req.headers.forEach((v, k) => { reqHeaders[k] = v; });
      await captureException(err, {
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
