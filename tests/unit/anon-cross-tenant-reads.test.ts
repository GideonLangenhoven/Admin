import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A caller holding nothing but the public anon key could read every tenant's
// bookings in production (found 2026-08-15 by tests/tenant-isolation/probe.mjs).
// Three separate holes, each of which had already been "fixed" once:
//
//   1. bookings_read granted SELECT on EVERY row whenever request.method was
//      POST or PATCH. The clause was added to let the checkout read back the row
//      it just wrote, but a PostgREST RPC call is also a POST — so any /rpc/*
//      invocation ran with the policy disabled. Proven live: anon
//      check_loyalty(phone, <any business_id>) returned exact PAID counts for
//      every tenant.
//   2. search_bookings_by_ref took business_id from the caller, ran SECURITY
//      DEFINER with PUBLIC EXECUTE, and had no caller in the repo.
//   3. calculate_booking_refund had been revoked FROM PUBLIC in migration
//      20260504000000, but the grant to anon came back.
//
// These assert against supabase/security-baseline.json — the committed snapshot
// of live policy and grant state — so they go red the moment the baseline is
// refreshed after a regression, not just when someone edits a migration.
const baseline = JSON.parse(readFileSync("supabase/security-baseline.json", "utf8"));
const policies: Array<{ tablename: string; policyname: string; cmd: string; roles: string; qual: string | null }> =
  baseline.policies;

describe("no policy grants a blanket read on the HTTP method alone", () => {
  // The general rule, not just the bookings instance: testing request.method is
  // fine, but it must never be the ONLY thing standing between anon and a row.
  // Any such clause must be conjoined with a tenant predicate.
  it("every request.method clause is ANDed with a business_id check", () => {
    const offenders = policies
      .filter((p) => /request\.method/.test(p.qual || ""))
      .filter((p) => {
        // Isolate the OR-branch containing request.method and require that the
        // same branch also constrains business_id.
        const branch = (p.qual || "")
          .split(/\bOR\b/i)
          .find((b) => /request\.method/.test(b)) || "";
        return !/business_id/.test(branch);
      })
      .map((p) => p.tablename + "." + p.policyname);
    expect(offenders).toEqual([]);
  });
});

describe("anon cannot reach booking data through SECURITY DEFINER helpers", () => {
  const anonExec = (fn: string) =>
    (baseline.function_grants || []).some(
      (g: { grantee: string; function_name: string }) =>
        g.grantee === "anon" && g.function_name.startsWith(fn),
    );

  // Only meaningful once the baseline snapshot records function grants; until
  // then the live check in tests/tenant-isolation/probe.mjs is the guard.
  it.skipIf(!baseline.function_grants)("anon holds no EXECUTE on the booking-data helpers", () => {
    expect(anonExec("search_bookings_by_ref")).toBe(false);
    expect(anonExec("calculate_booking_refund")).toBe(false);
    expect(anonExec("check_loyalty")).toBe(false);
  });
});

describe("bookings_read keeps its narrow customer-facing doors", () => {
  const readPolicy = policies.find((p) => p.tablename === "bookings" && p.policyname === "bookings_read");

  it("exists and is SELECT for anon", () => {
    expect(readPolicy).toBeDefined();
    expect(readPolicy!.cmd).toBe("SELECT");
  });

  it("still admits the success-page and waiver token reads", () => {
    // Narrowing the POST/PATCH clause must not take these with it: the success
    // page and the waiver link are how customers see their own booking.
    expect(readPolicy!.qual).toContain("x-booking-success-token");
    expect(readPolicy!.qual).toContain("x-booking-waiver-token");
  });

  it("still admits the operator's own admin session", () => {
    expect(readPolicy!.qual).toContain("current_business_ids");
  });
});
