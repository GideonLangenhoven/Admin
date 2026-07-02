import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B2 — Expired regular holds must release slot capacity (J5).
// The regular-hold expiry branch in cron-tasks must decrement slots.held
// (via adjust_slot_capacity on the hold's own slot), mirroring the
// reschedule branch — otherwise every abandoned checkout permanently
// shrinks the slot's sellable capacity.
describe("expired regular hold capacity release (B2)", () => {
  const cronTasks = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");

  it("releases held capacity on the hold's slot when a regular hold expires", () => {
    expect(cronTasks).toContain("p_slot_id: hold.slot_id");
    expect(cronTasks).toContain("p_held_delta: -heldQty");
  });

  it("keeps the reschedule-branch release on the new slot intact", () => {
    expect(cronTasks).toContain("p_slot_id: pr.new_slot_id");
  });
});
