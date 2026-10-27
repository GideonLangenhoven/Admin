// Intentionally not an MCP server. No OAuth discovery/Connect UI is advertised
// until scoped credentials, RLS confinement and both provider flows are tested.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disabled() {
  return Response.json({ ok: false, code: "INTEGRATION_DISABLED" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
}

export const GET = disabled;
export const POST = disabled;
