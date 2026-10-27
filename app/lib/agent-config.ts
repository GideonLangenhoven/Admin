export type AgentProvider = "CHATGPT" | "MUSE";
export type AgentConfig = {
  provider: AgentProvider; origin: string; issuer: string; resource: string;
  metadata: string; redirects: string[]; pilotBusinesses: string[];
};
export const AGENT_SCOPES = ["departures:read", "availability:read", "attention:read"];
export const AGENT_BODY_LIMIT = 16_384;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
export class AgentHttpError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export function agentConfig(provider: AgentProvider, revocationOnly=false): AgentConfig | null {
  // Muse's transport/client/auth contract is not established. Environment
  // variables cannot turn that track on before an independently tested adapter.
  if (provider === "MUSE" || (!revocationOnly && process.env.AGENT_CHATGPT_ENABLED !== "true")) return null;
  try {
    const url = new URL(process.env.AGENT_PUBLIC_ORIGIN || "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const redirects: unknown = JSON.parse(process.env.AGENT_CHATGPT_REDIRECT_URIS || "[]");
    const pilots: unknown = JSON.parse(process.env.AGENT_PILOT_BUSINESS_IDS || "[]");
    if (!Array.isArray(redirects) || (!revocationOnly && !redirects.length) || redirects.length > 8 || !redirects.every(value => {
      if (typeof value !== "string") return false;
      const redirect = new URL(value);
      return redirect.origin === "https://chatgpt.com" && !redirect.username && !redirect.password
        && !redirect.search && !redirect.hash && (redirect.pathname === "/connector_platform_oauth_redirect"
          || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(redirect.pathname));
    }) || !Array.isArray(pilots) || (!revocationOnly && !pilots.length) || pilots.length > 100
      || !pilots.every(value => typeof value === "string" && UUID.test(value))) return null;
    if (!process.env.AGENT_DATABASE_URL || (!revocationOnly && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))) return null;
    const origin = url.origin;
    return { provider, origin, issuer: origin, resource: origin + "/api/mcp/chatgpt",
      metadata: origin + "/.well-known/oauth-protected-resource/api/mcp/chatgpt",
      redirects: redirects as string[], pilotBusinesses: (pilots as string[]).map(value => value.toLowerCase()) };
  } catch { return null; }
}
export function agentReject(code: string, status: number, extra: Record<string, string> = {}) {
  return Response.json({ ok: false, code }, { status, headers: { ...NO_STORE, ...extra } });
}
export function challenge(config: AgentConfig, scopes: readonly string[], insufficient = false) {
  return `Bearer resource_metadata="${config.metadata}", scope="${scopes.join(" ")}", error="${insufficient ? "insufficient_scope" : "invalid_token"}", error_description="Sign in to grant the requested read permissions"`;
}
export function requireSameOrigin(request: Request, config: AgentConfig, required = false) {
  if (new URL(request.url).origin !== config.origin
    || (request.headers.has("host") && request.headers.get("host") !== new URL(config.origin).host)) throw new AgentHttpError("FORBIDDEN",403);
  if ((required || request.headers.has("origin")) && request.headers.get("origin") !== config.origin) throw new AgentHttpError("FORBIDDEN", 403);
}
export async function boundedBody(request: Pick<Request,"body">, maxBytes=AGENT_BODY_LIMIT, timeoutMs=5_000): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new AgentHttpError("INVALID_INPUT", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); void reader.cancel().catch(() => {}); }, timeoutMs);
  try {
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new AgentHttpError("REQUEST_TOO_LARGE", 413); }
      chunks.push(value);
    }
    if (controller.signal.aborted) throw new AgentHttpError("REQUEST_TIMEOUT", 408);
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { throw new AgentHttpError("INVALID_INPUT",400); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
