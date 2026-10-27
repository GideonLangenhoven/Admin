import { afterEach,describe,expect,it,vi } from "vitest";
import { agentConfig,boundedBody,challenge,requireSameOrigin } from "../../app/lib/agent-config";
import { isAgentTelemetry } from "../../app/lib/agent-telemetry";
import { handleMcp,handleAgentMetadata } from "../../app/lib/agent-mcp";
import { handleOAuth,handleConnections } from "../../app/lib/agent-oauth";
import { POST as muse } from "../../app/api/mcp/muse/route";

afterEach(()=>vi.unstubAllEnvs());
describe("production agent defaults and privacy (no database or provider)",()=>{
  it("routes reject access with no server-side configuration",async()=>{
    vi.stubEnv("AGENT_CHATGPT_ENABLED","");
    vi.stubEnv("AGENT_PUBLIC_ORIGIN","");vi.stubEnv("AGENT_DATABASE_URL","");
    for(const response of [await handleMcp(new Request("https://fixture.invalid/api/mcp/chatgpt"),"CHATGPT"),
      await handleOAuth(new Request("https://fixture.invalid/api/agent/oauth/authorize"),"authorize"),await handleConnections(new Request("https://fixture.invalid/api/agent/connections")),await handleAgentMetadata("authorization"),await muse()]) {
      expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toEqual({ ok:false,code:"INTEGRATION_DISABLED" });
    }
  });
  it("Muse remains closed even when its environment flag is true",()=>{ vi.stubEnv("AGENT_MUSE_ENABLED","true");expect(agentConfig("MUSE")).toBeNull(); });
  it.each(["http://example.com","https://u:p@example.com","https://example.com/untrusted","https://example.com?x=1"])("invalid canonical origin fails closed: %s",origin=>{
    vi.stubEnv("AGENT_CHATGPT_ENABLED","true");vi.stubEnv("AGENT_PUBLIC_ORIGIN",origin);expect(agentConfig("CHATGPT")).toBeNull();
  });
  it.each(["https://fixture.invalid/api/agent/oauth/token?code=PRIVATE","https://fixture.invalid/api/mcp/chatgpt","https://fixture.invalid/settings/agent-connections?request=PRIVATE","https://fixture.invalid/.well-known/oauth-protected-resource/api/mcp/chatgpt"])("agent telemetry is suppressed: %s",url=>{
    expect(isAgentTelemetry({ request:{ url } })).toBe(true);expect(isAgentTelemetry({ data:{ url } })).toBe(true);expect(isAgentTelemetry({ transaction:"GET "+new URL(url).pathname })).toBe(true);
  });
  it("unrelated application telemetry is retained",()=>{ expect(isAgentTelemetry({ request:{ url:"https://fixture.invalid/bookings" } })).toBe(false); });
  it("oversized streaming body is rejected before unbounded buffering",async()=>{
    const response=new Response(new ReadableStream({ start(controller){ controller.enqueue(new Uint8Array(16_385));controller.close(); } }));
    await expect(boundedBody(response)).rejects.toMatchObject({ code:"REQUEST_TOO_LARGE",status:413 });
  });
  it("a stalled request body times out",async()=>{
    const response=new Response(new ReadableStream({ start(){} }));
    await expect(boundedBody(response,16384,10)).rejects.toMatchObject({ code:"REQUEST_TIMEOUT",status:408 });
  });
  it("invalid UTF-8 fails with a fixed input error",async()=>{
    await expect(boundedBody(new Response(new Uint8Array([255])))).rejects.toMatchObject({ code:"INVALID_INPUT",status:400 });
  });
  it("canonical-origin validation rejects another server authority",()=>{
    const config={ origin:"https://fixture.invalid" } as NonNullable<ReturnType<typeof agentConfig>>;
    expect(()=>requireSameOrigin(new Request("https://attacker.invalid/api/mcp/chatgpt"),config)).toThrow("FORBIDDEN");
    expect(()=>requireSameOrigin(new Request("https://fixture.invalid/api/mcp/chatgpt",{ headers:{ host:"attacker.invalid" } }),config)).toThrow("FORBIDDEN");
    expect(()=>requireSameOrigin(new Request("https://fixture.invalid/api/mcp/chatgpt"),config,true)).toThrow("FORBIDDEN");
  });
  it("authorization challenge includes discovery and a safe explanation",()=>{
    const config={ metadata:"https://fixture.invalid/.well-known/oauth-protected-resource/api/mcp/chatgpt" } as NonNullable<ReturnType<typeof agentConfig>>;
    const value=challenge(config,["departures:read"],true);
    expect(value).toContain('error="insufficient_scope"');expect(value).toContain('error_description=');expect(value).toContain('resource_metadata=');
  });
});
