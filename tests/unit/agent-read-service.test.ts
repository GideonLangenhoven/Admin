import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeAgentRead } from "../../app/lib/agent-read-service";
import { AGENT_TOOLS } from "../../app/lib/agent-tools";
import { GET, POST } from "../../app/api/agent/read/route";

import { id, at, issuer, input, fixture } from "../helpers/agent-read-fixture";

beforeEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("ck_rate_limit_stores")];
});

describe("disabled external routes", () => {
  it("rejects GET and direct POST without touching credentials or database", async () => {
    process.env.BOOKINGTOURS_AGENT_ENABLED = "true";
    for (const handler of [GET, POST]) {
      const response = handler();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "INTEGRATION_DISABLED" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    delete process.env.BOOKINGTOURS_AGENT_ENABLED;
  });
  it("keeps the shared service closed without a labelled test fixture", async () => {
    const f = fixture();
    const result = await executeAgentRead(f.request(), "get_departure_availability", input, { db: f.db as unknown as SupabaseClient, issuer, audit: () => {} });
    expect(result.body).toEqual({ ok: false, code: "INTEGRATION_DISABLED" });
    expect(f.auth.getClaims).not.toHaveBeenCalled();
  });
});

describe("credential and connection authorisation (mocked Auth fixtures)", () => {
  it.each(["CHATGPT", "MUSE"])("allows a current MAIN_ADMIN grant for all three %s reads", async (provider) => {
    for (const operation of Object.keys(AGENT_TOOLS)) {
      const f = fixture();
      f.rows.agent_connection_grants[0].provider = provider;
      const args = operation === "list_departures"
        ? {business_id: id(1), start_at: "2026-10-02T10:00:00Z", end_at: "2026-10-04T10:00:00Z"}
        : input;
      expect((await f.run(operation, args)).status).toBe(200);
    }
  });
  it.each(["OPERATOR", "ADMIN", "SUPER_ADMIN", "GUIDE", "UNKNOWN", "main_admin", null])("denies %s even with a matching grant for every provider/read", async (role) => {
    for (const provider of ["CHATGPT", "MUSE"]) {
      for (const operation of Object.keys(AGENT_TOOLS)) {
        const f = fixture();
        f.rows.admin_users[0].role = role;
        f.rows.agent_connection_grants[0].role_at_consent = role;
        f.rows.agent_connection_grants[0].provider = provider;
        const args = operation === "list_departures"
          ? {business_id: id(1), start_at: "2026-10-02T10:00:00Z", end_at: "2026-10-04T10:00:00Z"}
          : input;
        expect((await f.run(operation, args)).body).toEqual({ok: false, code: "FORBIDDEN"});
        expect(f.calls.some((call) => ["slots", "tours", "bookings"].includes(call.table))).toBe(false);
        expect(f.db.rpc).not.toHaveBeenCalled();
      }
    }
  });
  it("requires renewed owner consent after a staff member becomes MAIN_ADMIN", async () => {
    const f = fixture();
    f.rows.agent_connection_grants[0].role_at_consent = "ADMIN";
    expect((await f.run()).body).toEqual({ok: false, code: "CONNECTION_INACTIVE"});
  });
  it("expires at exactly 168 hours despite a still-valid refreshed token", async () => {
    const f = fixture();
    const expires = Date.parse("2026-10-09T10:00:00Z");
    f.claims.exp = Date.parse("2026-10-10T10:00:00Z") / 1000;
    f.setTime(expires - 1);
    f.values.agent_read_observed_at = new Date(expires - 1).toISOString();
    expect((await f.run()).status).toBe(200);
    f.setTime(expires);
    expect((await f.run(undefined, input, f.request("refreshed-fixture-token"))).body).toEqual({ok: false, code: "CONNECTION_INACTIVE"});
    expect(f.rows.agent_connection_grants[0]).toMatchObject({created_at: "2026-10-02T10:00:00Z", expires_at: "2026-10-09T10:00:00Z"});
  });
  it.each([null, undefined, "not-a-date", "2026-02-31T10:00:00Z", "2026-10-02T10:00:00.001Z", "2026-09-30T10:00:00Z"])("denies invalid/future/overlong grant creation %s", async (created) => {
    const f = fixture();
    f.rows.agent_connection_grants[0].created_at = created;
    expect((await f.run()).body).toEqual({ok: false, code: "CONNECTION_INACTIVE"});
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it.each(["2026-10-09T10:00:00.001Z", "2026-10-10T10:00:00Z"])("denies grant expiry beyond seven days: %s", async (expires) => {
    const f = fixture();
    f.rows.agent_connection_grants[0].expires_at = expires;
    expect((await f.run()).body).toEqual({ok: false, code: "CONNECTION_INACTIVE"});
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it("permits an explicitly shortened grant within the seven-day maximum", async () => {
    const f = fixture();
    f.rows.agent_connection_grants[0].expires_at = "2026-10-02T11:00:00Z";
    expect((await f.run()).status).toBe(200);
  });
  it("rechecks grant expiry after the read before returning data", async () => {
    const f = fixture();
    const expires = Date.parse("2026-10-09T10:00:00Z");
    f.claims.exp = Date.parse("2026-10-10T10:00:00Z") / 1000;
    f.setTime(expires - 1);
    f.values.agent_read_observed_at = new Date(expires - 1).toISOString();
    f.afterRpc.slot_available_capacity = () => f.setTime(expires);
    expect((await f.run()).body).toEqual({ok: false, code: "CONNECTION_INACTIVE"});
  });
  it("requires validated credentials and remote identity", async () => {
    const f = fixture();
    expect((await f.run(undefined, input, f.request(""))).status).toBe(401);
    f.auth.getClaims.mockResolvedValue({ data: { claims: f.claims }, error: new Error("bad signature") });
    expect((await f.run()).status).toBe(401);
    expect(f.calls).toEqual([]);
  });
  it.each([
    ["exp", at/1000], ["nbf", at/1000+1], ["aud", "different-resource"], ["iss", "https://wrong.invalid"],
    ["agent_resource", "other"], ["role", "service_role"], ["agent_grant_id", undefined], ["client_id", undefined],
  ])("rejects invalid token claim %s", async (claim,value) => {
    const f = fixture(); f.claims[claim] = value;
    expect((await f.run()).status).toBe(401);
    expect(f.calls).toEqual([]);
  });
  it("rejects deleted/revoked identity and changed subject", async () => {
    const f = fixture(); f.auth.getUser.mockResolvedValue({ data: { user: { id: id(90) } }, error: new Error("revoked") });
    expect((await f.run()).status).toBe(401);
  });
  it.each(["departures:read", "availability:read", "attention:read"])("checks token and persisted scope %s", async scope => {
    const op = scope === "attention:read" ? "get_departure_attention_summary" : "get_departure_availability";
    const f = fixture(); f.claims.scope = (f.claims.scope as string).replace(scope, "");
    expect((await f.run(op)).body).toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    f.claims.scope = "departures:read availability:read attention:read";
    f.rows.agent_connection_grants[0].scopes = ["unused"];
    expect((await f.run(op)).body).toMatchObject({ code: "INSUFFICIENT_SCOPE" });
  });
  it.each([
    ["enabled",false], ["expires_at","2026-10-02T09:59:00Z"], ["disconnected_at","2026-10-02T09:59:00Z"],
    ["client_id","other-client"], ["user_id",id(77)], ["business_id",id(88)],
  ])("rejects an inactive/mismatched grant (%s)", async (field,value) => {
    const f = fixture(); f.rows.agent_connection_grants[0][field] = value;
    expect((await f.run()).body).toMatchObject({ code: "CONNECTION_INACTIVE" });
  });
  it("rejects missing grants and membership", async () => {
    const f = fixture(); f.rows.agent_connection_grants = [];
    expect((await f.run()).body).toMatchObject({ code: "CONNECTION_INACTIVE" });
    f.rows.admin_users = [];
    expect((await f.run()).body).toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["OPERATOR","ADMIN","SUPER_ADMIN","GUIDE"])("rejects role change to %s", async role => {
    const f = fixture(); f.rows.admin_users[0].role = role;
    expect((await f.run()).status).toBe(403);
  });
  it.each(["SUSPENDED","PAUSED","CANCELLED","INACTIVE","UNKNOWN"])("preserves the subscription gate: %s", async status => {
    const f = fixture(); f.rows.businesses[0].subscription_status = status;
    expect((await f.run()).status).toBe(403);
  });
  it("rejects suspended membership and browser-selected tenant overrides", async () => {
    const f = fixture(); f.rows.admin_users[0].suspended = true;
    expect((await f.run()).status).toBe(403);
    const req = f.request(); req.headers.set("x-admin-business-id", id(88));
    expect((await f.run(undefined, input, req)).status).toBe(403);
  });
  it.each(["list_departures", "get_departure_availability", "get_departure_attention_summary"])("rejects Business A asking for Business B with %s", async op => {
    const f = fixture();
    const args = op === "list_departures" ? { business_id: id(88), start_at: "2026-10-02T10:00:00Z", end_at: "2026-10-04T10:00:00Z" } : { ...input, business_id: id(88) };
    expect((await f.run(op, args)).status).toBe(403);
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it.each(["get_departure_availability", "get_departure_attention_summary"])("checks a foreign departure on %s", async op => {
    const f = fixture(); f.rows.slots[0].business_id = id(88);
    expect((await f.run(op)).status).toBe(404);
    expect(f.db.rpc.mock.calls.map(call => call[0])).toEqual(["agent_read_observed_at"]);
  });
  it("rechecks disconnect, role changes and expiry after data reads", async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.rows.agent_connection_grants[0].disconnected_at = "2026-10-02T10:00:00Z"; },
      (f: ReturnType<typeof fixture>) => { f.rows.admin_users[0].role = "ADMIN"; },
      (f: ReturnType<typeof fixture>) => { f.rows.admin_users[0].role = "ADMIN"; f.rows.agent_connection_grants[0].role_at_consent = "ADMIN"; },
      (f: ReturnType<typeof fixture>) => { f.setTime(at + 3_601_000); },
    ]) {
      const f = fixture(); f.afterRpc.slot_available_capacity = () => change(f);
      expect((await f.run()).status).toBeGreaterThanOrEqual(401);
    }
  });
});

describe("participant waiver aggregate boundary", () => {
  it("reports people separately from payment bookings through the restricted aggregate RPC", async () => {
    const f = fixture();
    f.values.agent_departure_waiver_counts = {outstanding_waiver_participants: 3, reason: null,
      participants: [{name: "Private participant fixture", dob: "1990-01-01", accepts_liability: true}],
      guardian_id_number: "private-fixture-id", waiver_token: "private-fixture-token"};
    const result = await f.run("get_departure_attention_summary");
    expect(result.body.result).toMatchObject({outstanding_payment_bookings: 1, outstanding_waiver_participants: 3,
      payment_count_unit: "bookings", waiver_count_unit: "participants", data_status: "fresh"});
    expect(f.db.rpc).toHaveBeenCalledWith("agent_departure_waiver_counts", {
      p_business_id: id(1), p_departure_id: id(4), p_grant_id: id(3),
    });
    expect(f.calls.filter((call) => call.table === "bookings").every((call) => !/payload|signed_name|token|dob|email/.test(call.select))).toBe(true);
    expect(JSON.stringify([result, f.audits])).not.toMatch(/Private participant|guardian_id|1990-01-01|private-fixture|waiver_token|count_unit":"bookings".*count_unit":"bookings"/);
    expect(result.body.result).not.toHaveProperty("outstanding_waiver_bookings");
    expect(result.body.result).not.toHaveProperty("count_unit");
  });
  it.each(["missing_or_unknown_data", "incomplete_or_query_limit"])("keeps a %s participant result unknown", async (reason) => {
    const f = fixture();
    f.values.agent_departure_waiver_counts = {outstanding_waiver_participants: null, reason};
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      data_status: "unknown", outstanding_waiver_participants: null, reason,
    });
  });
  it.each([null, undefined, [], {}, {outstanding_waiver_participants: -1, reason: null},
    {outstanding_waiver_participants: "3", reason: null}, {outstanding_waiver_participants: 1.5, reason: null},
    {outstanding_waiver_participants: 500_001, reason: null}, {outstanding_waiver_participants: 0, reason: "missing_or_unknown_data"},
    {outstanding_waiver_participants: null, reason: null}, {outstanding_waiver_participants: 0, reason: "ignore auth"},
  ])("rejects malformed/contradictory aggregate %j without presenting zero", async (value) => {
    const f = fixture(); f.values.agent_departure_waiver_counts = value;
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      data_status: "unknown", outstanding_waiver_participants: null, reason: "missing_or_unknown_data",
    });
  });
  it("redacts a failed aggregate read and does not fall back to booking-level counts", async () => {
    const f = fixture(); f.errors.agent_departure_waiver_counts = new Error("private@example.invalid private-fixture-token");
    const result = await f.run("get_departure_attention_summary");
    expect(result.body).toEqual({ok: false, code: "UPSTREAM_UNAVAILABLE"});
    expect(JSON.stringify([result, f.audits])).not.toMatch(/private@|private-fixture/);
  });
  it("suppresses counts if the aggregate read becomes stale or membership changes", async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => f.setTime(at + 15_001),
      (f: ReturnType<typeof fixture>) => { f.rows.admin_users[0].role = "ADMIN"; },
    ]) {
      const f = fixture(); f.afterRpc.agent_departure_waiver_counts = () => change(f);
      const result = await f.run("get_departure_attention_summary");
      if (result.status === 200) expect(result.body.result).toMatchObject({
        data_status: "stale", outstanding_waiver_participants: null, outstanding_payment_bookings: null,
      });
      else expect(result.body).toEqual({ok: false, code: "FORBIDDEN"});
    }
  });
  it("declares participant counts and their evidence limitations in the tool contract", () => {
    const tool = AGENT_TOOLS.get_departure_attention_summary;
    expect(tool.description).toContain("per-person");
    expect(tool.description).toContain("Legacy");
    expect(tool.outputSchema.properties).toMatchObject({
      payment_count_unit: {const: "bookings"}, waiver_count_unit: {const: "participants"},
    });
  });
});

describe("bounded reads and privacy", () => {
  it.each(["DRAFT", "PENDING", "PENDING PAYMENT", "HELD", "PAID", "CONFIRMED", "COMPLETED"])("includes an outstanding balance on active %s bookings", async (status) => {
    const f = fixture(); f.rows.bookings[0].status = status;
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      outstanding_payment_bookings: 1, payment_count_unit: "bookings", data_status: "fresh",
    });
  });
  it.each(["CANCELLED", "EXPIRED"])("excludes unpaid %s bookings from payment attention", async (status) => {
    const f = fixture(); f.rows.bookings[0].status = status;
    f.values.agent_departure_waiver_counts = {outstanding_waiver_participants: 0, reason: null};
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      outstanding_payment_bookings: 0, data_status: "fresh",
    });
  });
  it("does not count fully paid active bookings or reopen legacy settled balances", async () => {
    const f = fixture(); const row = f.rows.bookings[0];
    f.rows.bookings = [{...row, total_captured: 800}, {...row, status: "PAID", total_captured: 0}, {...row, status: "COMPLETED", total_captured: 0}];
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      outstanding_payment_bookings: 0, data_status: "fresh",
    });
  });
  it("uses the canonical capacity RPC without creating a hold", async () => {
    const f = fixture(); const result = await f.run();
    expect(result.body.result).toMatchObject({ available_seats: 3, seat_hold_created: false, booking_eligibility: "not_evaluated", timezone: "Africa/Johannesburg", data_status: "fresh" });
    expect(f.db.rpc.mock.calls.map(call => call[0])).toEqual(["agent_read_observed_at", "slot_available_capacity"]);
    expect(JSON.stringify(result)).not.toContain("Private fixture");
  });
  it.each([0,null,undefined,-1,"3"])("handles capacity %s explicitly", async value => {
    const f = fixture(); f.values.slot_available_capacity = value;
    const result = await f.run();
    expect(result.body.result).toMatchObject(value === 0 ? { available_seats: 0, data_status: "fresh" } : { available_seats: null, data_status: "unknown" });
  });
  it("returns zero sellable seats for a closed departure", async () => {
    const f = fixture(); f.rows.slots[0].status = "CLOSED";
    expect((await f.run()).body.result).toMatchObject({ available_seats: 0 });
  });
  it.each(["get_departure_availability", "get_departure_attention_summary"])("does not confirm stale results for %s", async op => {
    const f = fixture(); f.values.agent_read_observed_at = new Date(at - 15_001).toISOString();
    const result = await f.run(op);
    expect(result.body.result).toMatchObject(op === "get_departure_availability"
      ? { available_seats: null, data_status: "stale" }
      : { outstanding_payment_bookings: null, outstanding_waiver_participants: null, data_status: "stale" });
  });
  it("aggregates partial/legacy payments using the existing accounting helper and excludes cancelled bookings", async () => {
    const f = fixture(); const row = f.rows.bookings[0];
    f.rows.bookings.push({ ...row, status: "PAID", total_captured: 0, waiver_status: "SIGNED" }, { ...row, status: "CANCELLED" });
    const result = await f.run("get_departure_attention_summary");
    expect(result.body.result).toMatchObject({outstanding_payment_bookings: 1, outstanding_waiver_participants: 1,
      payment_count_unit: "bookings", waiver_count_unit: "participants"});
    const selected = f.calls.find(call => call.table === "bookings")!;
    expect(selected.select).toBe("status,waiver_status,total_amount,total_captured");
    expect(selected.limit).toBe(501);
    expect(JSON.stringify([result,f.audits])).not.toMatch(/private@|secret fixture|total_amount|customer_name|fixture-token/);
    expect(JSON.stringify(f.audits)).not.toContain("00000000-0000-4000-8000");
  });
  it.each(["source", "destination"])("does not report zero payments while a %s departure has an unresolved reschedule", async side => {
    const f = fixture();
    f.rows.bookings[0] = { ...f.rows.bookings[0], status: "PAID", total_captured: 800, waiver_status: "SIGNED" };
    f.rows.pending_reschedules.push({
      id: id(60), business_id: id(1), status: "PENDING", diff: 200,
      new_slot_id: side === "destination" ? id(4) : id(6),
      old_slot_id: side === "source" ? id(4) : id(6),
      customer_name: "Private pending fixture", payment_url: "https://private.example.invalid/secret",
    });
    const result = await f.run("get_departure_attention_summary");
    expect(result.body.result).toMatchObject({ data_status: "unknown", outstanding_payment_bookings: null,
      reason: "pending_reschedule_payments_not_evaluated" });
    const pendingReads = f.calls.filter(call => call.table === "pending_reschedules");
    expect(pendingReads).toHaveLength(2);
    expect(pendingReads.every(call => call.select === "id" && call.limit === 501
      && call.filters.some(([op, key, value]) => op === "eq" && key === "business_id" && value === id(1)))).toBe(true);
    expect(JSON.stringify([result, f.audits])).not.toMatch(/Private pending|private.example|payment_url|diff/);
  });
  it("ignores another business or unrelated departure's pending reschedule", async () => {
    const f = fixture();
    f.values.agent_departure_waiver_counts = {outstanding_waiver_participants: 0, reason: null};
    f.rows.bookings[0] = { ...f.rows.bookings[0], status: "PAID", total_captured: 800, waiver_status: "SIGNED" };
    f.rows.pending_reschedules.push({ id: id(60), business_id: id(9), status: "PENDING", new_slot_id: id(4), old_slot_id: id(4) },
      { id: id(61), business_id: id(1), status: "PENDING", new_slot_id: id(6), old_slot_id: id(7) });
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      data_status: "fresh", outstanding_payment_bookings: 0, outstanding_waiver_participants: 0 });
  });
  it("fails closed when pending reschedule coverage cannot be checked", async () => {
    const f = fixture(); f.errors.pending_reschedules = new Error("Private provider fixture");
    expect((await f.run("get_departure_attention_summary")).body).toEqual({ ok: false, code: "UPSTREAM_UNAVAILABLE" });
    expect(JSON.stringify(f.audits)).not.toContain("Private provider fixture");
  });
  it("returns unknown when pending reschedules exceed the query ceiling", async () => {
    const f = fixture();
    f.rows.pending_reschedules = Array.from({ length: 501 }, (_, n) => ({ id: id(100 + n),
      business_id: id(1), status: "PENDING", old_slot_id: id(4), new_slot_id: id(6) }));
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      data_status: "unknown", outstanding_payment_bookings: null, reason: "incomplete_or_query_limit" });
  });
  it.each([null,undefined,"UNRECOGNISED"])("does not turn unknown waiver status %s into zero", async value => {
    const f = fixture(); f.rows.bookings[0].waiver_status = value;
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({ data_status: "unknown", outstanding_waiver_participants: null });
  });
  it("does not turn missing financial data or truncated bookings into no issues", async () => {
    const f = fixture(); f.rows.bookings[0].total_captured = null;
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({ outstanding_payment_bookings: null, data_status: "unknown" });
    f.rows.bookings = Array.from({ length: 501 }, () => ({ ...f.rows.bookings[0], total_captured: 0 }));
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({ outstanding_payment_bookings: null, reason: "incomplete_or_query_limit" });
  });
  it("confirms zero counts only for a complete fresh empty result", async () => {
    const f = fixture(); f.rows.bookings = [];
    f.values.agent_departure_waiver_counts = {outstanding_waiver_participants: 0, reason: null};
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({ data_status: "fresh", outstanding_payment_bookings: 0, outstanding_waiver_participants: 0 });
  });
  it.each(["", " ", false, [], {}])("does not coerce malformed money %j into zero issues", async value => {
    const f = fixture(); f.rows.bookings[0].total_amount = value;
    expect((await f.run("get_departure_attention_summary")).body.result).toMatchObject({
      data_status: "unknown", outstanding_payment_bookings: null, outstanding_waiver_participants: null,
    });
  });
  it("does not confirm data that becomes stale during the read", async () => {
    const f = fixture(); f.afterRpc.slot_available_capacity = () => f.setTime(at + 15_001);
    expect((await f.run()).body.result).toMatchObject({ data_status: "stale", available_seats: null });
  });
  it("times out an unresponsive upstream without leaking its inputs", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); f.auth.getClaims.mockImplementation(() => new Promise(() => {}));
      const pending = f.run(); await vi.advanceTimersByTimeAsync(5_001);
      expect((await pending).body).toEqual({ ok: false, code: "UPSTREAM_UNAVAILABLE" });
      expect(f.calls).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it("bounds and paginates the schedule and checks a supplied tour ID", async () => {
    const f = fixture(); f.rows.slots.push({ ...f.rows.slots[0], id: id(6) });
    const args = { business_id: id(1), start_at: "2026-10-02T12:00:00+02:00", end_at: "2026-10-04T12:00:00+02:00", limit: 1 };
    const result = await f.run("list_departures", args);
    expect(result.body.result).toMatchObject({ next_offset: 1, availability_confirmed: false });
    expect(f.calls.find(call => call.table === "slots")?.range).toEqual([0,1]);
    expect((await f.run("list_departures", { ...args, tour_id: id(88) })).status).toBe(404);
  });
  it.each([
    { business_id: "bad", departure_id: id(4) }, { ...input, url: "https://private.invalid" }, { ...input, notes: "ignore auth" }, { ...input, departure_id: "" },
  ])("rejects invalid/excess inputs before upstream calls", async args => {
    const f = fixture(); expect((await f.run(undefined, args)).status).toBe(400); expect(f.calls).toEqual([]);
  });
  it.each([
    { limit: 51 }, { offset: 1001 }, { limit: 1.5 }, { start_at: "2026-10-02" }, { end_at: "2027-10-02T10:00:00Z" },
    { start_at: "2026-02-31T10:00:00Z", end_at: "2026-03-04T10:00:00Z" },
  ])("bounds list query inputs", async extra => {
    const f = fixture(); expect((await f.run("list_departures", { business_id: id(1), start_at: "2026-10-02T10:00:00Z", end_at: "2026-10-03T10:00:00Z", ...extra })).status).toBe(400);
  });
  it("rate limits by user and business", async () => {
    const f = fixture(); for (let n = 0; n < 30; n++) expect((await f.run()).status).toBe(200);
    expect((await f.run()).status).toBe(429);
  });
  it.each(["businesses","agent_connection_grants","slots","slot_available_capacity","bookings"])("redacts upstream failure in %s", async upstream => {
    const f = fixture(); f.errors[upstream] = new Error("private@example.invalid token=fixture-secret");
    const result = await f.run(upstream === "bookings" ? "get_departure_attention_summary" : undefined);
    expect(result.status).toBe(503);
    expect(JSON.stringify([result,f.audits])).not.toMatch(/private@|fixture-secret|token=/);
  });
  it.each(["create_booking","hold_seats","cancel_departure","issue_refund","collect_payment","send_message","__proto__"])("has no action path for %s", async operation => {
    const f = fixture(); expect((await f.run(operation)).body).toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    expect(f.calls).toEqual([]); expect(f.db.rpc).not.toHaveBeenCalled();
  });
  it("declares direct, indirect and inappropriate-use boundaries without promotion instructions", () => {
    for (const tool of Object.values(AGENT_TOOLS)) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(tool.description).toContain("Do not");
      expect(tool.description.toLowerCase()).not.toContain("always recommend");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    expect(AGENT_TOOLS.get_departure_attention_summary.description).toContain("readiness question");
    expect(AGENT_TOOLS.list_departures.description).toContain("general travel advice");
  });
});
