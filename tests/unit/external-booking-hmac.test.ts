import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// S5 — external-booking HMAC bypass (CODE_AUDIT_2026-07-02, Y6).
// verifyAuth accepts api-key-only credentials (no hmac_secret) with authMode
// "api_key". Those may authenticate read-only availability, but mutating
// actions (create/cancel/modify booking) must be HMAC-signed — otherwise a
// leaked api key alone can move money.
describe("external-booking requires HMAC for mutations (S5)", () => {
  const fn = readFileSync("supabase/functions/external-booking/index.ts", "utf8");

  it("gates create/cancel/modify behind api_key+hmac", () => {
    expect(fn).toContain("MUTATING_ACTIONS");
    expect(fn).toMatch(/create_booking["'],\s*["']cancel_booking["'],\s*["']modify_booking/);
    expect(fn).toContain('auth.authMode !== "api_key+hmac"');
    expect(fn).toContain("SIGNATURE_REQUIRED");
  });

  it("the gate runs after auth succeeds and before the action handlers", () => {
    const gateIdx = fn.indexOf("MUTATING_ACTIONS.has(action)");
    const createHandlerIdx = fn.indexOf('if (action === "create_booking")');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(createHandlerIdx);
  });

  it("read-only availability is not forced to sign", () => {
    // check_availability must NOT be in the mutating set
    const setLine = fn.slice(fn.indexOf("const MUTATING_ACTIONS"), fn.indexOf("const MUTATING_ACTIONS") + 120);
    expect(setLine).not.toContain("check_availability");
  });
});
