import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260922110000_operator_dashboard_snapshot.sql", "utf8");
const runner = readFileSync("tests/stress/bt500-mixed.k6.js", "utf8");
const launcher = readFileSync("scripts/bt500-run-mixed.mjs", "utf8");

describe("operator dashboard snapshot", () => {
  it("replaces the dashboard read fan-out and coalesces Realtime bursts", () => {
    expect(page).toContain('supabase.rpc("get_operator_dashboard"');
    expect(page).not.toContain('.from("bookings")');
    expect(page).not.toContain('.from("slots")');
    expect(page).not.toContain('.from("conversations")');
    expect(page).not.toContain('.from("trip_photos")');
    expect(page).toContain("realtimeRefreshRef.current = setTimeout");
  });

  it("keeps the RPC invoker-scoped and unavailable to anonymous callers", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("public.current_business_ids()");
    expect(migration).toMatch(/revoke all on function public\.get_operator_dashboard\([\s\S]*?from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.get_operator_dashboard\([\s\S]*?to authenticated, service_role;/);
  });

  it("measures the optimized product request without changing the action budget", () => {
    expect(runner).toContain("/rpc/get_operator_dashboard");
    expect(runner).toContain('journey: "dashboard_snapshot"');
    expect(runner).not.toContain("http.batch([");
    expect(launcher).toContain("SUPABASE_ACCESS_TOKEN");
    expect(launcher).toContain(`/database/query`);
  });
});
