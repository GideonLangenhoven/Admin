import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B2 — Expired regular holds must release slot capacity (J5).
// The regular-hold expiry branch in cron-tasks must decrement slots.held
// (via adjust_slot_capacity on the hold's own slot), mirroring the
// reschedule branch — otherwise every abandoned checkout permanently
// shrinks the slot's sellable capacity.
describe("expired regular hold capacity release (B2)", () => {
  const cronTasks = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260911150000_booking_cancellation.sql", "utf8");

  it("routes every expiry through the single authoritative RPC (R16)", () => {
    expect(cronTasks).toContain('supabase.rpc("expire_single_hold"');
  });

  it("releases held capacity tenant-checked inside the RPC, never double-counted", () => {
    expect(migration).toContain("business_id = b.business_id");
    expect(migration).toContain("GREATEST(0, COALESCE(held, 0) - h.qty)");
  });

  it("reschedule holds expire in the same transaction as their capacity", () => {
    expect(migration).toContain("hold_type IN ('RESCHEDULE', 'ADD_GUESTS')");
    expect(migration).toContain("UPDATE pending_reschedules SET status = 'EXPIRED'");
  });

  it("does not release capacity again in the notification worker", () => {
    expect(cronTasks).not.toContain("p_slot_id: pr.new_slot_id");
  });
});
