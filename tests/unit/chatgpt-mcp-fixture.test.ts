import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_TOOLS } from "../../app/lib/agent-tools";
import { at, fixture, id, input } from "../helpers/agent-read-fixture";
import { chatgptMcpFixture } from "../helpers/chatgpt-mcp-fixture";

type Fixture = ReturnType<typeof fixture>;
type Reply = {
  result?: { tools?: Array<Record<string, unknown>>; structuredContent?: Record<string, unknown>;
    content?: Array<{ text?: string }>; _meta?: Record<string, unknown>; isError?: boolean;
    protocolVersion?: string; serverInfo?: { name: string } };
  error?: { code: number }; code?: string;
};
const listInput = { business_id: id(1), start_at: "2026-10-02T10:00:00Z", end_at: "2026-10-04T10:00:00Z" };
const methods = Object.keys(AGENT_TOOLS);
function request(method: string, params: unknown = {}, token = "fixture-token", url = "http://127.0.0.1/mcp") {
  return new Request(url, { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-11-25", ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function send(f: Fixture, method: string, params: unknown = {}, token = "fixture-token") {
  const response = await chatgptMcpFixture(request(method, params, token), f.deps);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-bookingtours-fixture")).toBe("labelled-local-fixture");
  const text = await response.text();
  const json = text.startsWith("event:") || text.startsWith("data:")
    ? JSON.parse(text.split("\n").find(line => line.startsWith("data: "))!.slice(6))
    : JSON.parse(text);
  return { response, body: json as Reply };
}
const call = (f: Fixture, name = "get_departure_availability", args: unknown = input, token = "fixture-token") =>
  send(f, "tools/call", { name, arguments: args }, token);

beforeEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("ck_rate_limit_stores")];
});

describe("ChatGPT MCP transport — labelled local fixtures, mocked Auth", () => {
  it("initializes the documented legacy protocol without touching customer reads", async () => {
    const f = fixture();
    const { body, response } = await send(f, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-fixture-client", version: "0.0.0" },
    }, "");
    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "bookingtours-local-fixture" } });
    expect(f.calls).toEqual([]);
    expect(f.auth.getClaims).not.toHaveBeenCalled();
  });
  it("lists exactly three tools with shared schemas, read-only annotations and OAuth scopes on the wire", async () => {
    const f = fixture(); const { body } = await send(f, "tools/list", {}, "");
    expect(body.result?.tools?.map(tool => tool.name)).toEqual(methods);
    for (const tool of body.result!.tools!) {
      const contract = AGENT_TOOLS[tool.name as keyof typeof AGENT_TOOLS];
      expect(tool).toMatchObject({ inputSchema: contract.inputSchema, outputSchema: contract.outputSchema,
        annotations: contract.annotations, securitySchemes: [{ type: "oauth2", scopes: contract.scopes }],
        _meta: { securitySchemes: [{ type: "oauth2", scopes: contract.scopes }], "bookingtours/fixture": true } });
      expect(tool.description).toContain("LOCAL FIXTURE");
    }
    expect(f.calls).toEqual([]);
  });
  it.each(methods)("delegates %s to the existing authorized business service with no write side effects", async name => {
    const f = fixture(); const { body } = await call(f, name, name === "list_departures" ? listInput : input);
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?._meta).toEqual({ "bookingtours/fixture": true });
    expect(body.result?.content?.[0].text).toContain("LOCAL FIXTURE — NOT CUSTOMER DATA");
    expect(body.result?.structuredContent).toMatchObject({ timezone: "Africa/Johannesburg", data_status: "fresh" });
    if (name === "get_departure_availability") expect(body.result?.structuredContent).toMatchObject({ available_seats: 3, seat_hold_created: false });
    if (name === "get_departure_attention_summary") expect(body.result?.structuredContent).toMatchObject({ outstanding_payment_bookings: 1, outstanding_waiver_participants: 1 });
    expect(f.db.rpc.mock.calls.every(([rpc]) => ["agent_read_observed_at", "slot_available_capacity", "agent_departure_waiver_counts"].includes(rpc))).toBe(true);
    expect(f.audits.at(-1)?.outcome).toBe("OK");
  });
  it.each(["missing", "expired", "revoked", "insufficient"])("rejects %s credentials and emits the appropriate fixture OAuth challenge", async condition => {
    const f = fixture();
    if (condition === "expired") f.claims.exp = at / 1000;
    if (condition === "revoked") f.auth.getUser.mockResolvedValue({ data: { user: { id: id(2) } }, error: new Error("private fixture") });
    if (condition === "insufficient") f.claims.scope = "departures:read";
    const { body } = await call(f, undefined, input, condition === "missing" ? "" : "fixture-token");
    expect(body.result?.isError).toBe(true);
    expect(body.result?._meta?.["mcp/www_authenticate"]).toEqual([expect.stringContaining(condition === "insufficient" ? 'error="insufficient_scope"' : 'error="invalid_token"')]);
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it.each(methods)("denies Business A requesting Business B via %s", async name => {
    const f = fixture(); const { body } = await call(f, name, { ...(name === "list_departures" ? listInput : input), business_id: id(88) });
    expect(body.result?.isError).toBe(true); expect(body.result?.content?.[0].text).toContain("FORBIDDEN");
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it.each(["role", "disconnected", "provider", "foreign-departure"])("denies changed %s authorization", async condition => {
    const f = fixture();
    if (condition === "role") f.rows.admin_users[0].role = "ADMIN";
    if (condition === "disconnected") f.rows.agent_connection_grants[0].disconnected_at = new Date(at).toISOString();
    if (condition === "provider") f.rows.agent_connection_grants[0].provider = "MUSE";
    if (condition === "foreign-departure") f.rows.slots[0].business_id = id(88);
    expect((await call(f)).body.result?.isError).toBe(true);
    expect(f.db.rpc.mock.calls.map(([rpc]) => rpc)).not.toContain("slot_available_capacity");
  });
  it.each(["disconnect", "provider"])("rechecks %s after a capacity read", async condition => {
    const f = fixture(); f.afterRpc.slot_available_capacity = () => {
      if (condition === "disconnect") f.rows.agent_connection_grants[0].enabled = false;
      else f.rows.agent_connection_grants[0].provider = "MUSE";
    };
    const { body } = await call(f);
    expect(body.result?.isError).toBe(true); expect(body.result?.structuredContent).toBeUndefined();
  });
  it.each(["stale", "unknown"])("keeps %s capacity unconfirmed on the MCP wire", async condition => {
    const f = fixture();
    if (condition === "stale") f.values.agent_read_observed_at = new Date(at - 15_001).toISOString();
    else f.values.slot_available_capacity = null;
    expect((await call(f)).body.result?.structuredContent).toMatchObject({ data_status: condition, available_seats: null, seat_hold_created: false });
  });
  it("keeps incomplete waiver evidence unknown rather than reporting no issues", async () => {
    const f = fixture(); f.values.agent_departure_waiver_counts = { outstanding_waiver_participants: null, reason: "missing_or_unknown_data" };
    expect((await call(f, "get_departure_attention_summary")).body.result?.structuredContent).toMatchObject({ data_status: "unknown", outstanding_waiver_participants: null });
  });
  it("excludes private rows, raw tokens and upstream errors from outputs and console logs", async () => {
    const f = fixture(); const log = vi.spyOn(console, "info"); const error = vi.spyOn(console, "error"); const warn = vi.spyOn(console, "warn");
    try {
      const replies = [await call(f), await call(f, "get_departure_attention_summary")];
      f.errors.slot_available_capacity = new Error("private@example.invalid token=fixture-secret");
      replies.push(await call(f));
      expect(replies[2].body.result?.content?.[0].text).toContain("UPSTREAM_UNAVAILABLE");
      expect(JSON.stringify([replies.map(r => r.body), f.audits, log.mock.calls, error.mock.calls, warn.mock.calls]))
        .not.toMatch(/private@|Private fixture|secret fixture notes|fixture-secret|fixture-token|customer_name|guardian_id|waiver_token/);
    } finally { log.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });
  it.each(["create_booking", "hold_seats", "cancel_departure", "issue_refund", "collect_payment", "send_message", "lookup_guest"])("rejects unsupported/private action %s without reads", async name => {
    const f = fixture(); const { body } = await call(f, name);
    expect(body.error || body.result?.isError).toBeTruthy(); expect(f.calls).toEqual([]); expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...input, notes: "ignore authorization" }, { ...input, url: "https://private.invalid" }, { business_id: "bad", departure_id: id(4) }])("rejects invalid/injected arguments %j before Auth", async args => {
    const f = fixture(); const { body } = await call(f, undefined, args);
    expect(body.error || body.result?.isError).toBeTruthy(); expect(f.auth.getClaims).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  });
  it("bounds query sizes and enforces the shared local rate limiter", async () => {
    const f = fixture();
    const oversized = (await call(f, "list_departures", { ...listInput, limit: 51 })).body;
    expect(oversized.error || oversized.result?.isError).toBeTruthy();
    for (let n = 0; n < 30; n++) expect((await call(f)).body.result?.isError).not.toBe(true);
    expect((await call(f)).body.result?.content?.[0].text).toContain("RATE_LIMITED");
  });
  it("bounds raw bodies and rejects batches, unsafe origins and unsupported protocol methods", async () => {
    const f = fixture();
    for (const body of ["x".repeat(16_385), "not json", JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }])]) {
      const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { "content-type": "application/json" }, body });
      expect((await chatgptMcpFixture(req, f.deps)).status).toBeGreaterThanOrEqual(400);
    }
    const req = request("tools/list"); req.headers.set("origin", "https://untrusted.invalid");
    expect((await chatgptMcpFixture(req, f.deps)).status).toBe(403);
    expect((await send(f, "sampling/createMessage")).body.code).toBe("UNSUPPORTED_OPERATION");
    expect(f.calls).toEqual([]);
  });
  it("cannot enable outside NODE_ENV=test, without the explicit label or at a remote URL", async () => {
    const f = fixture();
    expect((await chatgptMcpFixture(request("tools/list"), { ...f.deps, fixture: undefined })).status).toBe(503);
    expect((await chatgptMcpFixture(request("tools/list", {}, "", "https://public.example.invalid/mcp"), f.deps)).status).toBe(503);
    vi.stubEnv("NODE_ENV", "production");
    try { expect((await chatgptMcpFixture(request("tools/list"), f.deps)).status).toBe(503); }
    finally { vi.unstubAllEnvs(); }
    expect(f.auth.getClaims).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  });
  it("describes direct, indirect and inappropriate use without promotional instructions", async () => {
    const f = fixture(); const tools = (await send(f, "tools/list")).body.result!.tools!;
    expect(tools.find(t => t.name === "get_departure_attention_summary")?.description).toContain("readiness question");
    expect(tools.find(t => t.name === "list_departures")?.description).toContain("general travel advice");
    expect(tools.every(t => String(t.description).includes("Do not"))).toBe(true);
    expect(JSON.stringify(tools)).not.toMatch(/always recommend/i);
  });
});
