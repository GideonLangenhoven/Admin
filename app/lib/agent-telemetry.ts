// Agent OAuth/consent requests contain credentials or security-sensitive state.
// Suppress their error/trace/breadcrumb payloads at the telemetry boundary. The
// shared read service emits its own allowlisted, hashed security audit events.
const path=/\/(?:api\/(?:agent|mcp)|settings\/agent-connections|\.well-known\/oauth-(?:authorization-server|protected-resource))(?:[/?]|$)/;
export function isAgentTelemetry(event: { request?: { url?: string }; transaction?: string; data?: Record<string,unknown> }): boolean {
  if (typeof window!=="undefined" && path.test(window.location.pathname)) return true;
  return [event.request?.url,event.transaction,event.data?.url,event.data?.to,event.data?.from]
    .some(value=>typeof value==="string" && path.test(value));
}
