import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260922110000_operator_dashboard_snapshot.sql", "utf8");
const admissionMigration = readFileSync("supabase/migrations/20260922123000_operator_hot_path_admission.sql", "utf8");
const arrivalServer = readFileSync("app/lib/booking-arrivals-server.ts", "utf8");
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

  it("keeps the RPC tenant-scoped while avoiding repeated RLS admission", () => {
    expect(migration).toContain("public.current_business_ids()");
    expect(admissionMigration).toMatch(/alter function public\.get_operator_dashboard\([\s\S]*?\) security definer;/);
    expect(migration).toMatch(/revoke all on function public\.get_operator_dashboard\([\s\S]*?from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.get_operator_dashboard\([\s\S]*?to authenticated, service_role;/);
  });

  it("collapses authenticated arrival authorization and mutation into one RPC", () => {
    expect(admissionMigration).toContain("a.user_id = auth.uid()");
    expect(admissionMigration).toContain("not coalesce(a.suspended, false)");
    expect(admissionMigration).toContain("not coalesce(a.read_only, false)");
    expect(admissionMigration).toContain("public.record_booking_arrival(");
    expect(admissionMigration).toMatch(/grant execute on function public\.record_authenticated_booking_arrival\([\s\S]*?to authenticated;/);
    expect(arrivalServer).toContain('.rpc("record_authenticated_booking_arrival"');
    expect(arrivalServer).not.toContain("getCallerAdmin");
  });

  it("measures the optimized product request without changing the action budget", () => {
    expect(runner).toContain("/rpc/get_operator_dashboard");
    expect(runner).toContain('journey: "dashboard_snapshot"');
    expect(runner).not.toContain("http.batch([");
    expect(launcher).toContain("SUPABASE_ACCESS_TOKEN");
    expect(launcher).toContain(`/database/query`);
  });
});
