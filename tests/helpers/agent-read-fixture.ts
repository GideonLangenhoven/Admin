import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeAgentRead, type AgentAudit } from "../../app/lib/agent-read-service";
import { AGENT_RESOURCE } from "../../app/lib/agent-tools";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const at = Date.parse("2026-10-02T10:00:00Z");
export const issuer = "https://auth.example.invalid/auth/v1";
export const input = { business_id: id(1), departure_id: id(4) };

// Labelled LOCAL FIXTURE. Auth signatures/provider behaviour are mocked, not
// claimed as a real Supabase, ChatGPT or Muse authorisation journey.
export function fixture() {
  let currentTime = at;
  const calls: Array<{ table: string; select: string; filters: Array<[string,string,unknown]>; limit?: number; range?: number[] }> = [];
  const audits: AgentAudit[] = [];
  const claims: Record<string, unknown> = {
    sub: id(2), iss: issuer, aud: "authenticated", role: "authenticated", exp: at / 1000 + 3600,
    client_id: "fixture-client", agent_grant_id: id(3), agent_resource: AGENT_RESOURCE,
    scope: "departures:read availability:read attention:read",
  };
  const rows: Record<string, Array<Record<string, unknown>>> = {
    admin_users: [{ id: id(10), user_id: id(2), business_id: id(1), role: "MAIN_ADMIN", suspended: false }],
    businesses: [{ id: id(1), timezone: "Africa/Johannesburg", subscription_status: "ACTIVE" }],
    agent_connection_grants: [{ id: id(3), user_id: id(2), business_id: id(1), client_id: "fixture-client", provider: "CHATGPT",
      role_at_consent: "MAIN_ADMIN", enabled: true, scopes: ["departures:read", "availability:read", "attention:read"],
      created_at: "2026-10-02T10:00:00Z", expires_at: "2026-10-09T10:00:00Z", disconnected_at: null }],
    slots: [{ id: id(4), business_id: id(1), tour_id: id(5), start_time: "2026-10-03T10:00:00Z", status: "OPEN", customer_name: "Private fixture" }],
    tours: [{ id: id(5), business_id: id(1) }],
    pending_reschedules: [],
    bookings: [{ business_id: id(1), slot_id: id(4), status: "PENDING PAYMENT", total_amount: 800, total_captured: 400, waiver_status: "PENDING", email: "private@example.invalid", notes: "secret fixture notes" }],
  };
  const errors: Record<string, unknown> = {};
  const values: Record<string, unknown> = { agent_read_observed_at: new Date(at).toISOString(), slot_available_capacity: 3,
    agent_departure_waiver_counts: {outstanding_waiver_participants: 1, reason: null} };
  const afterRpc: Record<string, () => void> = {};
  const auth = {
    getClaims: vi.fn(async () => ({ data: { claims }, error: null as unknown })),
    getUser: vi.fn(async () => ({ data: { user: { id: id(2) } }, error: null as unknown })),
  };
  const db = {
    auth,
    rpc: vi.fn(async (name: string) => {
      afterRpc[name]?.();
      return { data: values[name], error: errors[name] || null };
    }),
    from(table: string) {
      const call = { table, select: "", filters: [] as Array<[string,string,unknown]>, limit: undefined as number | undefined, range: undefined as number[] | undefined };
      calls.push(call);
      let single = false;
      let counting = false;
      const query = {
        select(columns: string, options?: { count?: string }) { call.select = columns; counting = !!options?.count; return query; },
        eq(key: string, value: unknown) { call.filters.push(["eq",key,value]); return query; },
        gte(key: string, value: unknown) { call.filters.push(["gte",key,value]); return query; },
        lt(key: string, value: unknown) { call.filters.push(["lt",key,value]); return query; },
        order() { return query; },
        range(start: number, end: number) { call.range = [start,end]; return query; },
        limit(limit: number) { call.limit = limit; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          let selected = rows[table].filter(row => call.filters.every(([op,key,value]) =>
            op === "eq" ? row[key] === value : op === "gte" ? String(row[key]) >= String(value) : String(row[key]) < String(value)));
          const count = selected.length;
          if (call.range) selected = selected.slice(call.range[0], call.range[1] + 1);
          if (call.limit) selected = selected.slice(0, call.limit);
          // Deliberately return extra private fields to verify the service's
          // output projection, even when a hypothetical upstream overreturns.
          return Promise.resolve(resolve({ data: single ? selected[0] || null : selected,
            error: errors[table] || null, count: counting ? count : null }));
        },
      };
      return query;
    },
  };
  const request = (token = "fixture-token") => new Request("http://local.invalid/api/agent/read", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
  const deps: Parameters<typeof executeAgentRead>[3] = { db: db as unknown as SupabaseClient, issuer, now: () => currentTime,
    audit: event => audits.push(event), fixture: "labelled-local-fixture" };
  const run = (operation = "get_departure_availability", args: unknown = input, req = request()) =>
    executeAgentRead(req, operation, args, deps);
  return { deps, run, rows, auth, claims, errors, values, calls, audits, db, afterRpc, request, setTime: (time: number) => { currentTime = time; } };
}

